use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

pub const ROUTELLM_BASE_URL: &str = "https://routellm.abacus.ai/v1";

/// Weights used to convert usage into "units": 1 unit = 1 token or 1 tool
/// call. Images will get their own weight when image models arrive. Units are
/// the billing-agnostic proxy the budget ledger runs on until real credits are
/// computed from the /v1/models pricing map (planned for M1b).
const UNIT_PER_TOKEN: f64 = 1.0;
const UNIT_PER_TOOL_CALL: f64 = 1.0;

/// One shared HTTP client for the whole process. Creating a reqwest::Client
/// per request pays a fresh TLS handshake on every message; a shared client
/// reuses connections (keep-alive), shaving latency off every call after the
/// first one.
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(reqwest::Client::new)
}

/// Models whose upstream rejects the Responses API are remembered here for the
/// rest of the session, so we never pay a failed-request penalty twice.
/// Cleared on app restart (self-heals if RouteLLM adds support later).
static RESPONSES_UNSUPPORTED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn responses_unsupported() -> &'static Mutex<HashSet<String>> {
    RESPONSES_UNSUPPORTED.get_or_init(|| Mutex::new(HashSet::new()))
}

/// True when a string is valid UTF-8. Used to ignore binary decode failures.
fn valid_utf8(bytes: &[u8]) -> bool {
    std::str::from_utf8(bytes).is_ok()
}

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
    let reasoning_tokens = get_i64(&["reasoning_tokens"])
        .max(usage["output_tokens_details"]["reasoning_tokens"].as_i64().unwrap_or(0))
        .max(usage["completion_tokens_details"]["reasoning_tokens"].as_i64().unwrap_or(0));
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
    ReasoningDelta { text: String },
    Done,
}

/// Which wire protocol to use for a model. Reasoning models must go through
/// the Responses API (the only endpoint that exposes reasoning); some models
/// reject the Responses API entirely and must use Chat Completions.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ApiKind {
    Responses,
    ChatCompletions,
}

/// Picks the endpoint for a model. Reasoning models (kimi, deepseek, o-series,
/// gpt-5, grok-4) use the Responses API so we receive reasoning summaries and
/// never 400 on chat/completions' lack of reasoning support.
pub fn api_kind_for_model(model: &str) -> ApiKind {
    let m = model.to_lowercase();
    let responses_markers = ["gpt-5", "o1", "o3", "o4", "grok"];
    if responses_markers.iter().any(|k| m.contains(k)) {
        ApiKind::Responses
    } else {
        ApiKind::ChatCompletions
    }
}

/// Non-streaming call, kept for simple internal uses later (M1b verifier).
pub async fn chat_completion(model: &str, messages: &[ChatMessage]) -> Result<(String, UsageInfo, String, Option<String>), String> {
    let api_key = crate::settings::load_api_key()?;
    let body = json!({ "model": model, "messages": messages });

    let client = http_client();
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

/// Chat Completions streaming call (fallback for models without Responses API).
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

    let client = http_client();
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
    let mut saw_reasoning = false;

    use futures_util::StreamExt;
    let mut byte_stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.map_err(|e| format!("RouteLLM stream read failed: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

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
                Err(_) => continue,
            };

            if model_used.is_none() {
                model_used = json["model"].as_str().map(|s| s.to_string());
            }
            if !json["usage"].is_null() {
                let (u, uj) = parse_usage_value(&json["usage"], &full_text);
                usage = u;
                usage_json = uj;
            }

            let reasoning_piece = json["choices"][0]["delta"]["reasoning_content"]
                .as_str()
                .or_else(|| json["choices"][0]["delta"]["reasoning"].as_str())
                .unwrap_or("");
            if !reasoning_piece.is_empty() {
                if !saw_reasoning && !saw_first_delta {
                    saw_reasoning = true;
                    on_event(StreamEventPayload::Status { stage: "reasoning".into() });
                }
                on_event(StreamEventPayload::ReasoningDelta { text: reasoning_piece.to_string() });
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

/// Responses API streaming call. Converts the chat-style message list into
/// Responses `input`, enables reasoning summaries, and parses the SSE events.
/// Returns the assistant text plus usage; also returns the reasoning summary
/// so the caller can persist it on the message if desired.
pub async fn responses_stream<F>(
    model: &str,
    messages: &[ChatMessage],
    mut on_event: F,
) -> Result<(String, String, UsageInfo, String, Option<String>), String>
where
    F: FnMut(StreamEventPayload) + Send,
{
    let api_key = crate::settings::load_api_key()?;

    // Convert chat messages -> Responses input items. The system prompt becomes
    // `instructions`; the rest become input items with content parts.
    let mut instructions = String::new();
    let mut input_items: Vec<serde_json::Value> = Vec::new();
    for m in messages {
        if m.role == "system" {
            if !instructions.is_empty() {
                instructions.push_str("\n\n");
            }
            instructions.push_str(&m.content);
        } else {
            input_items.push(json!({
                "type": "message",
                "role": m.role,
                "content": [{ "type": "input_text", "text": m.content }]
            }));
        }
    }

    let body = json!({
        "model": model,
        "instructions": instructions,
        "input": input_items,
        "stream": true,
        "reasoning": { "summary": "auto" }
    });

    let client = http_client();
    let response = client
        .post(format!("{}/responses", ROUTELLM_BASE_URL))
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
    let mut reasoning_summary = String::new();
    let mut usage = UsageInfo::default();
    let mut usage_json = String::new();
    let mut model_used: Option<String> = None;
    let mut saw_first_delta = false;
    let mut saw_reasoning = false;

    use futures_util::StreamExt;
    let mut byte_stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut current_event_type = String::new();

    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.map_err(|e| format!("RouteLLM stream read failed: {}", e))?;
        if !valid_utf8(&chunk) {
            continue;
        }
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline_pos) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline_pos).collect();
            let line = line.trim_end_matches('\r').to_string();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Some(ev) = line.strip_prefix("event:") {
                current_event_type = ev.trim().to_string();
                continue;
            }
            if !line.starts_with("data:") {
                continue;
            }
            let payload = line.trim_start_matches("data:").trim();
            if payload == "[DONE]" {
                on_event(StreamEventPayload::Done);
                return Ok((full_text, reasoning_summary, usage, usage_json, model_used));
            }
            let json: serde_json::Value = match serde_json::from_str(payload) {
                Ok(v) => v,
                Err(_) => continue,
            };

            // The SSE event type is authoritative; fall back to a "type" field.
            let ev_type = if !current_event_type.is_empty() {
                current_event_type.clone()
            } else {
                json["type"].as_str().unwrap_or("").to_string()
            };

            match ev_type.as_str() {
                "response.reasoning_summary_text.delta" | "response.reasoning_summary.delta" => {
                    let delta = json["delta"].as_str().unwrap_or("");
                    if !delta.is_empty() {
                        if !saw_reasoning && !saw_first_delta {
                            saw_reasoning = true;
                            on_event(StreamEventPayload::Status { stage: "reasoning".into() });
                        }
                        reasoning_summary.push_str(delta);
                        on_event(StreamEventPayload::ReasoningDelta { text: delta.to_string() });
                    }
                }
                "response.output_text.delta" => {
                    let delta = json["delta"].as_str().unwrap_or("");
                    if !delta.is_empty() {
                        if !saw_first_delta {
                            saw_first_delta = true;
                            on_event(StreamEventPayload::Status { stage: "generating".into() });
                        }
                        full_text.push_str(delta);
                        on_event(StreamEventPayload::Delta { text: delta.to_string() });
                    }
                }
                "response.completed" => {
                    let resp = &json["response"];
                    if model_used.is_none() {
                        model_used = resp["model"].as_str().map(|s| s.to_string());
                    }
                    if !resp["usage"].is_null() {
                        let (u, uj) = parse_usage_value(&resp["usage"], &full_text);
                        usage = u;
                        usage_json = uj;
                    }
                    // If the stream delivered no deltas (rare), fall back to
                    // aggregating output_text parts from the final response.
                    if full_text.is_empty() {
                        if let Some(items) = resp["output"].as_array() {
                            for item in items {
                                if item["type"].as_str() == Some("message") {
                                    if let Some(parts) = item["content"].as_array() {
                                        for p in parts {
                                            if p["type"].as_str() == Some("output_text") {
                                                if let Some(t) = p["text"].as_str() {
                                                    full_text.push_str(t);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    on_event(StreamEventPayload::Done);
                    return Ok((full_text, reasoning_summary, usage, usage_json, model_used));
                }
                "response.created" | "response.in_progress" => {
                    if model_used.is_none() {
                        model_used = json["response"]["model"].as_str().map(|s| s.to_string());
                    }
                }
                "response.output_item.done" => {
                    // Capture usage if it rides along on an item (some providers).
                    if !json["item"]["usage"].is_null() {
                        let (u, uj) = parse_usage_value(&json["item"]["usage"], &full_text);
                        usage = u;
                        usage_json = uj;
                    }
                }
                _ => {}
            }
            current_event_type.clear();
        }
    }

    on_event(StreamEventPayload::Done);
    if full_text.is_empty() {
        return Err("RouteLLM stream ended without any content.".into());
    }
    Ok((full_text, reasoning_summary, usage, usage_json, model_used))
}

/// Streams a reply from the model, choosing the wire protocol per model.
/// Models with documented Responses API support (GPT-5 family, o-series, Grok)
/// are tried there first to get reasoning summaries; if that call fails BEFORE
/// anything was streamed, we silently retry on Chat Completions and remember
/// the model for the rest of the session. A mid-stream failure is surfaced
/// (retrying would duplicate output).
/// Returns (text, reasoning_summary, usage, usage_json, model_used).
pub async fn stream_model_reply<F>(
    model: &str,
    messages: &[ChatMessage],
    mut on_event: F,
) -> Result<(String, String, UsageInfo, String, Option<String>), String>
where
    F: FnMut(StreamEventPayload) + Send,
{
    let wants_responses = api_kind_for_model(model) == ApiKind::Responses;
    let already_failed = responses_unsupported()
        .lock()
        .map(|set| set.contains(model))
        .unwrap_or(false);

    if wants_responses && !already_failed {
        let emitted_any = Arc::new(AtomicBool::new(false));
        let emitted_flag = emitted_any.clone();

        let attempt = {
            let on_event_ref = &mut on_event;
            responses_stream(model, messages, move |event| {
                match &event {
                    StreamEventPayload::Delta { .. } | StreamEventPayload::ReasoningDelta { .. } => {
                        emitted_flag.store(true, Ordering::Relaxed);
                    }
                    _ => {}
                }
                on_event_ref(event);
            })
            .await
        };

        match attempt {
            Ok(v) => return Ok(v),
            Err(e) => {
                if emitted_any.load(Ordering::Relaxed) {
                    return Err(format!("{} (stream failed mid-way; not retried to avoid duplicate output)", e));
                }
                eprintln!(
                    "[zeus] Responses API rejected {} ({}). Using chat/completions for the rest of this session.",
                    model, e
                );
                if let Ok(mut set) = responses_unsupported().lock() {
                    set.insert(model.to_string());
                }
            }
        }
    }

    let (text, usage, usage_json, model_used) = chat_completion_stream(model, messages, &mut on_event).await?;
    Ok((text, String::new(), usage, usage_json, model_used))
}

#[tauri::command]
pub async fn fetch_available_models() -> Result<Vec<String>, String> {
    let api_key = crate::settings::load_api_key()?;
    let client = http_client();
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