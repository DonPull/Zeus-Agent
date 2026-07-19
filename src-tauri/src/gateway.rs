use serde::{Deserialize, Serialize};
use serde_json::json;

pub const ROUTELLM_BASE_URL: &str = "https://routellm.abacus.ai/v1";

/// Weights used to convert usage into "units": 1 unit = 1 token or 1 tool
/// call. Images will get their own weight when image models arrive. Units are
/// the billing-agnostic proxy the budget ledger runs on until the real
/// credits-per-token rate is confirmed from the user's RouteLLM billing page.
const UNIT_PER_TOKEN: f64 = 1.0;
const UNIT_PER_TOOL_CALL: f64 = 1.0;

pub fn compute_units(input_tokens: i64, output_tokens: i64, reasoning_tokens: i64, tool_calls: i64, images: i64) -> f64 {
    (input_tokens + output_tokens + reasoning_tokens + images) as f64 * UNIT_PER_TOKEN
        + tool_calls as f64 * UNIT_PER_TOOL_CALL
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Default)]
pub struct UsageInfo {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_tokens: i64,
    pub total_tokens: i64,
    pub tool_calls: i64,
    pub images: i64,
}

impl UsageInfo {
    pub fn units(&self) -> f64 {
        compute_units(self.input_tokens, self.output_tokens, self.reasoning_tokens, self.tool_calls, self.images)
    }
}

fn parse_usage_value(usage: &serde_json::Value, fallback_content: &str) -> (UsageInfo, String) {
    let get_i64 = |keys: &[&str]| keys.iter().find_map(|k| usage[*k].as_i64()).unwrap_or(0);

    let input_tokens = get_i64(&["input_tokens", "prompt_tokens"]);
    let output_tokens = get_i64(&["output_tokens", "completion_tokens"]);
    // reasoning is usually included in output_tokens; only count it separately
    // when the provider reports it as its own top-level quantity.
    let reasoning_tokens = get_i64(&["reasoning_tokens"]);
    let total_tokens = get_i64(&["total_tokens"]).max(input_tokens + output_tokens);

    let tool_calls = usage["tool_calls"]
        .as_i64()
        .or_else(|| usage["tools_used"].as_i64())
        .unwrap_or_else(|| fallback_content.matches("```").count() as i64 / 2);
    let images = usage["images"].as_i64().unwrap_or(0);

    let usage_json = if usage.is_null() || usage.as_object().map(|o| o.is_empty()).unwrap_or(true) {
        String::new()
    } else {
        serde_json::to_string_pretty(usage).unwrap_or_default()
    };

    (UsageInfo { input_tokens, output_tokens, reasoning_tokens, total_tokens, tool_calls, images }, usage_json)
}

/// Emitted to the frontend as "chat-stream" events while the model generates.
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEventPayload {
    Status { stage: String },
    Delta { text: String },
    Done,
}

/// Non-streaming call, kept for simple internal uses later (M1+).
pub async fn chat_completion(model: &str, messages: &[ChatMessage]) -> Result<(String, UsageInfo, String, Option<String>), String> {
    let api_key = crate::settings::load_api_key()?;
    let body = json!({ "model": model, "messages": messages });

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/chat/completions", ROUTELLM_BASE_URL))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("RouteLLM request failed: {}", e))?;

    let status = response.status();
    let text = response.text().await.map_err(|e| format!("Failed to read the RouteLLM response: {}", e))?;
    if !status.is_success() {
        return Err(format!("RouteLLM error ({}): {}", status.as_u16(), text));
    }

    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse the RouteLLM response: {}", e))?;

    let content = json["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
    if content.is_empty() {
        return Err(format!("RouteLLM returned no message content: {}", text));
    }

    let (usage, usage_json) = parse_usage_value(&json["usage"], &content);
    let model_used = json["model"].as_str().map(|s| s.to_string());
    Ok((content, usage, usage_json, model_used))
}

/// Streaming call. `on_event` is invoked with status updates and text deltas
/// as they arrive; the function resolves to the full reply once the stream ends.
pub async fn chat_completion_stream<F>(
    model: &str,
    messages: &[ChatMessage],
    mut on_event: F,
) -> Result<(String, UsageInfo, String, Option<String>), String>
where
    F: FnMut(StreamEventPayload) + Send,
{
    let api_key = crate::settings::load_api_key()?;
    let body = json!({ "model": model, "messages": messages, "stream": true });

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/chat/completions", ROUTELLM_BASE_URL))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("RouteLLM request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("RouteLLM error ({}): {}", status.as_u16(), text));
    }

    on_event(StreamEventPayload::Status { stage: "connected".into() });

    let mut full_text = String::new();
    let mut usage = UsageInfo::default();
    let mut usage_json = String::new();
    let mut model_used: Option<String> = None;
    let mut saw_first_delta = false;

    // RouteLLM streams Server-Sent Events: lines of "data: {json}" with a
    // final "data: [DONE]". We read the body incrementally and parse per line.
    use futures_util::StreamExt;
    let mut byte_stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.map_err(|e| format!("RouteLLM stream read failed: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Consume every complete line in the buffer, keep the partial tail.
        while let Some(newline_pos) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline_pos).collect();
            let line = line.trim();
            if !line.starts_with("data:") {
                continue;
            }
            let payload = line.trim_start_matches("data:").trim();
            if payload == "[DONE]" {
                on_event(StreamEventPayload::Done);
                return Ok((full_text, usage, usage_json, model_used));
            }

            let json: serde_json::Value = match serde_json::from_str(payload) {
                Ok(v) => v,
                Err(_) => continue, // ignore keep-alives / partial frames
            };

            if model_used.is_none() {
                model_used = json["model"].as_str().map(|s| s.to_string());
            }
            if !json["usage"].is_null() {
                let (u, uj) = parse_usage_value(&json["usage"], &full_text);
                usage = u;
                usage_json = uj;
            }

            if let Some(delta) = json["choices"][0]["delta"]["content"].as_str() {
                if !delta.is_empty() {
                    if !saw_first_delta {
                        saw_first_delta = true;
                        on_event(StreamEventPayload::Status { stage: "generating".into() });
                    }
                    full_text.push_str(delta);
                    on_event(StreamEventPayload::Delta { text: delta.to_string() });
                }
            }
        }
    }

    on_event(StreamEventPayload::Done);
    if full_text.is_empty() {
        return Err("RouteLLM stream ended without any content.".into());
    }
    Ok((full_text, usage, usage_json, model_used))
}

#[tauri::command]
pub async fn fetch_available_models() -> Result<Vec<String>, String> {
    let api_key = crate::settings::load_api_key()?;
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/models", ROUTELLM_BASE_URL))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch the RouteLLM model list: {}", e))?;

    let status = response.status();
    let text = response.text().await.map_err(|e| format!("Failed to read the model list response: {}", e))?;
    if !status.is_success() {
        return Err(format!("RouteLLM error ({}): {}", status.as_u16(), text));
    }

    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse the model list: {}", e))?;

    let mut models: Vec<String> = json["data"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|m| m["id"].as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    models.sort();
    Ok(models)
}