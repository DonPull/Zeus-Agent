use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::State;
use crate::db::AppState;

pub const ROUTELLM_BASE_URL: &str = "https://routellm.abacus.ai/v1";
pub const GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/openai";

static LOCAL_MODELS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static LOCAL_BASE_URL: OnceLock<Mutex<String>> = OnceLock::new();

pub fn set_cached_local_url(url: String) {
    if let Ok(mut lock) = LOCAL_BASE_URL.get_or_init(|| Mutex::new("http://localhost:11434/v1".to_string())).lock() {
        *lock = url;
    }
}

pub fn get_cached_local_url() -> String {
    LOCAL_BASE_URL.get_or_init(|| Mutex::new("http://localhost:11434/v1".to_string()))
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "http://localhost:11434/v1".to_string())
}

fn local_models() -> &'static Mutex<HashSet<String>> {
    LOCAL_MODELS.get_or_init(|| Mutex::new(HashSet::new()))
}

pub fn register_local_models(models: &[String]) {
    if let Ok(mut set) = local_models().lock() {
        for m in models {
            set.insert(m.clone());
        }
    }
}

pub fn is_local_model(model: &str) -> bool {
    if model.starts_with("local/") || model.starts_with("local:") {
        return true;
    }
    if let Ok(set) = local_models().lock() {
        if set.contains(model) {
            return true;
        }
    }
    let m = model.to_lowercase();
    if m.contains("qwen")
        || m.contains("llama")
        || m.contains("mistral")
        || m.contains("gemma")
        || m.contains("deepseek-r1")
        || m.contains(".gguf")
        || m.contains(".bin")
        || m.contains(":latest")
        || m.contains("localhost")
    {
        return true;
    }
    if !model.starts_with("gemini") && crate::settings::load_api_key().is_err() {
        return true;
    }
    false
}

fn get_api_config(model: &str) -> Result<(String, String), String> {
    if let Ok(mock_url) = std::env::var("ZEUS_API_BASE_URL") {
        return Ok((mock_url, "test_key".to_string()));
    }

    if is_local_model(model) {
        let local_url = std::env::var("ZEUS_LOCAL_BASE_URL")
            .unwrap_or_else(|_| get_cached_local_url());
        return Ok((local_url, "local".to_string()));
    }

    if model.starts_with("gemini") {
        Ok((GEMINI_BASE_URL.to_string(), crate::settings::load_gemini_api_key()?))
    } else {
        match crate::settings::load_api_key() {
            Ok(key) => Ok((ROUTELLM_BASE_URL.to_string(), key)),
            Err(_) => {
                // If cloud RouteLLM key is missing, fall back to local endpoint
                let local_url = get_cached_local_url();
                Ok((local_url, "local".to_string()))
            }
        }
    }
}

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
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
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

pub fn compute_units(
    input_tokens: i64,
    output_tokens: i64,
    reasoning_tokens: i64,
    tool_calls: i64,
    images: i64,
) -> f64 {
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
        compute_units(
            self.input_tokens,
            self.output_tokens,
            self.reasoning_tokens,
            self.tool_calls,
            self.images,
        )
    }
}

fn parse_usage_value(usage: &serde_json::Value, fallback_content: &str) -> (UsageInfo, String) {
    let get_i64 = |keys: &[&str]| keys.iter().find_map(|k| usage[*k].as_i64()).unwrap_or(0);

    let input_tokens = get_i64(&["input_tokens", "prompt_tokens"]);
    let output_tokens = get_i64(&["output_tokens", "completion_tokens"]);
    let reasoning_tokens = get_i64(&["reasoning_tokens"])
        .max(
            usage["output_tokens_details"]["reasoning_tokens"]
                .as_i64()
                .unwrap_or(0),
        )
        .max(
            usage["completion_tokens_details"]["reasoning_tokens"]
                .as_i64()
                .unwrap_or(0),
        );
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

    (
        UsageInfo {
            input_tokens,
            output_tokens,
            reasoning_tokens,
            total_tokens,
            tool_calls,
            images,
        },
        usage_json,
    )
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

/// Which wire protocol to use for a model. Only OpenAI reasoning families
/// (gpt-5, o-series) are routed to the Responses API — RouteLLM documents it
/// for those, and live tests showed Kimi, DeepSeek, and grok-4.5 all 500 there.
/// Everything else uses Chat Completions; if a Responses call fails before the
/// first token, we silently retry on Chat Completions for the rest of the session.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ApiKind {
    Responses,
    ChatCompletions,
}

pub fn api_kind_for_model(model: &str) -> ApiKind {
    if is_local_model(model) || model.starts_with("gemini") {
        return ApiKind::ChatCompletions;
    }
    let m = model.to_lowercase();
    let responses_markers = ["gpt-5", "o1", "o3", "o4"];
    if responses_markers.iter().any(|k| m.contains(k)) {
        ApiKind::Responses
    } else {
        ApiKind::ChatCompletions
    }
}

pub fn normalize_chat_messages(messages: &[ChatMessage]) -> Vec<ChatMessage> {
    if messages.is_empty() {
        return Vec::new();
    }

    let mut result: Vec<ChatMessage> = Vec::new();
    let mut initial_system: Option<String> = None;
    let mut saw_non_system = false;

    for m in messages {
        if m.role == "system" {
            if !saw_non_system {
                // Merge consecutive leading system messages into a single system message at index 0
                if let Some(ref mut sys) = initial_system {
                    sys.push_str("\n\n");
                    sys.push_str(&m.content);
                } else {
                    initial_system = Some(m.content.clone());
                }
            } else {
                // System message appearing AFTER user/assistant messages:
                // Convert to user message with [System Note] prefix so strict Jinja chat templates (e.g. Qwen, Llama 3) don't crash
                result.push(ChatMessage {
                    role: "user".into(),
                    content: format!("[System Note]: {}", m.content),
                });
            }
        } else {
            saw_non_system = true;
            result.push(m.clone());
        }
    }

    if let Some(sys) = initial_system {
        result.insert(0, ChatMessage {
            role: "system".into(),
            content: sys,
        });
    }

    result
}

pub fn strip_think_tags(text: &str) -> (String, String) {
    if !text.contains("<think>") {
        return (text.to_string(), String::new());
    }

    let mut clean = String::new();
    let mut reasoning = String::new();
    let mut cursor = 0;

    while let Some(start_idx) = text[cursor..].find("<think>") {
        let abs_start = cursor + start_idx;
        clean.push_str(&text[cursor..abs_start]);
        let after_tag = abs_start + 7;
        if let Some(end_idx) = text[after_tag..].find("</think>") {
            let abs_end = after_tag + end_idx;
            reasoning.push_str(&text[after_tag..abs_end]);
            cursor = abs_end + 8;
        } else {
            // Unclosed <think> tag: treat the remainder as reasoning
            reasoning.push_str(&text[after_tag..]);
            cursor = text.len();
            break;
        }
    }

    if cursor < text.len() {
        clean.push_str(&text[cursor..]);
    }

    (clean.trim_start_matches(|c| c == '\r' || c == '\n').to_string(), reasoning)
}

struct ThinkFilter {
    in_think: bool,
    buffer: String,
    full_text: String,
    reasoning_text: String,
    saw_reasoning: bool,
    saw_generating: bool,
}

impl ThinkFilter {
    fn new() -> Self {
        Self {
            in_think: false,
            buffer: String::new(),
            full_text: String::new(),
            reasoning_text: String::new(),
            saw_reasoning: false,
            saw_generating: false,
        }
    }

    fn push_delta<F>(&mut self, delta: &str, on_event: &mut F)
    where
        F: FnMut(StreamEventPayload),
    {
        self.buffer.push_str(delta);

        loop {
            if !self.in_think {
                // Look for "<think>" in buffer
                if let Some(idx) = self.buffer.find("<think>") {
                    let before = self.buffer[..idx].to_string();
                    if !before.is_empty() {
                        if !self.saw_generating {
                            self.saw_generating = true;
                            on_event(StreamEventPayload::Status { stage: "generating".into() });
                        }
                        self.full_text.push_str(&before);
                        on_event(StreamEventPayload::Delta { text: before });
                    }
                    self.in_think = true;
                    if !self.saw_reasoning {
                        self.saw_reasoning = true;
                        on_event(StreamEventPayload::Status { stage: "reasoning".into() });
                    }
                    self.buffer = self.buffer[idx + 7..].to_string();
                } else {
                    // Check if the end of buffer might be an incomplete prefix of "<think>"
                    let potential_tags = ["<", "<t", "<th", "<thi", "<thin", "<think"];
                    let mut ends_with_prefix = false;
                    for tag in potential_tags {
                        if self.buffer.ends_with(tag) {
                            let safe_len = self.buffer.len() - tag.len();
                            let safe_part = self.buffer[..safe_len].to_string();
                            if !safe_part.is_empty() {
                                if !self.saw_generating {
                                    self.saw_generating = true;
                                    on_event(StreamEventPayload::Status { stage: "generating".into() });
                                }
                                self.full_text.push_str(&safe_part);
                                on_event(StreamEventPayload::Delta { text: safe_part });
                                self.buffer = self.buffer[safe_len..].to_string();
                            }
                            ends_with_prefix = true;
                            break;
                        }
                    }
                    if !ends_with_prefix && !self.buffer.is_empty() {
                        let text = std::mem::take(&mut self.buffer);
                        if !self.saw_generating {
                            self.saw_generating = true;
                            on_event(StreamEventPayload::Status { stage: "generating".into() });
                        }
                        self.full_text.push_str(&text);
                        on_event(StreamEventPayload::Delta { text });
                    }
                    break;
                }
            } else {
                // In think block: look for "</think>" in buffer
                if let Some(idx) = self.buffer.find("</think>") {
                    let before = self.buffer[..idx].to_string();
                    if !before.is_empty() {
                        self.reasoning_text.push_str(&before);
                        on_event(StreamEventPayload::ReasoningDelta { text: before });
                    }
                    self.in_think = false;
                    // Skip "</think>" and any immediately following newlines
                    let after = &self.buffer[idx + 8..];
                    let trimmed_after = after.trim_start_matches(|c| c == '\r' || c == '\n');
                    self.buffer = trimmed_after.to_string();
                } else {
                    // Check if the end of buffer might be an incomplete prefix of "</think>"
                    let potential_tags = ["<", "</", "</t", "</th", "</thi", "</thin", "</think"];
                    let mut ends_with_prefix = false;
                    for tag in potential_tags {
                        if self.buffer.ends_with(tag) {
                            let safe_len = self.buffer.len() - tag.len();
                            let safe_part = self.buffer[..safe_len].to_string();
                            if !safe_part.is_empty() {
                                self.reasoning_text.push_str(&safe_part);
                                on_event(StreamEventPayload::ReasoningDelta { text: safe_part });
                                self.buffer = self.buffer[safe_len..].to_string();
                            }
                            ends_with_prefix = true;
                            break;
                        }
                    }
                    if !ends_with_prefix && !self.buffer.is_empty() {
                        let text = std::mem::take(&mut self.buffer);
                        self.reasoning_text.push_str(&text);
                        on_event(StreamEventPayload::ReasoningDelta { text });
                    }
                    break;
                }
            }
        }
    }

    fn finish<F>(mut self, on_event: &mut F) -> (String, String)
    where
        F: FnMut(StreamEventPayload),
    {
        if !self.buffer.is_empty() {
            let leftover = std::mem::take(&mut self.buffer);
            if self.in_think {
                self.reasoning_text.push_str(&leftover);
                on_event(StreamEventPayload::ReasoningDelta { text: leftover });
            } else {
                if !self.saw_generating {
                    self.saw_generating = true;
                    on_event(StreamEventPayload::Status { stage: "generating".into() });
                }
                self.full_text.push_str(&leftover);
                on_event(StreamEventPayload::Delta { text: leftover });
            }
        }

        // Final sanitation check for any unparsed <think> blocks
        let (clean_text, extra_reasoning) = strip_think_tags(&self.full_text);
        if !extra_reasoning.is_empty() {
            if self.reasoning_text.is_empty() {
                self.reasoning_text = extra_reasoning;
            } else {
                self.reasoning_text.push_str("\n\n");
                self.reasoning_text.push_str(&extra_reasoning);
            }
        }

        (clean_text, self.reasoning_text)
    }
}

/// Non-streaming call, kept for simple internal uses later (M1b verifier).
pub async fn chat_completion(
    model: &str,
    messages: &[ChatMessage],
) -> Result<(String, UsageInfo, String, Option<String>), String> {
    let (base_url, api_key) = get_api_config(model)?;
    let normalized = normalize_chat_messages(messages);
    let body = json!({ "model": model, "messages": normalized });

    let client = http_client();
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(90),
        client
            .post(format!("{}/chat/completions", base_url))
            .bearer_auth(api_key)
            .json(&body)
            .send(),
    )
    .await
    .map_err(|_| "API request timed out after 90 seconds.".to_string())?
    .map_err(|e| format!("API request failed: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read the API response: {}", e))?;
    if !status.is_success() {
        return Err(format!("API error ({}): {}", status.as_u16(), text));
    }

    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse the API response: {}", e))?;

    let raw_content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if raw_content.is_empty() {
        return Err(format!("API returned no message content: {}", text));
    }

    let (content, _extracted_reasoning) = strip_think_tags(&raw_content);
    let (usage, usage_json) = parse_usage_value(&json["usage"], &content);
    let model_used = json["model"].as_str().map(|s| s.to_string());
    Ok((content, usage, usage_json, model_used))
}

/// Chat Completions streaming call (fallback for models without Responses API).
pub async fn chat_completion_stream<F>(
    model: &str,
    messages: &[ChatMessage],
    mut on_event: F,
) -> Result<(String, String, UsageInfo, String, Option<String>), String>
where
    F: FnMut(StreamEventPayload) + Send,
{
    let (base_url, api_key) = get_api_config(model)?;
    let normalized = normalize_chat_messages(messages);
    let body = json!({ "model": model, "messages": normalized, "stream": true });

    let client = http_client();
    let timeout_secs = if is_local_model(model) { 1800 } else { 300 };
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        client
            .post(format!("{}/chat/completions", base_url))
            .bearer_auth(api_key)
            .json(&body)
            .send(),
    )
    .await
    .map_err(|_| format!("API connection timed out after {} seconds.", timeout_secs))?
    .map_err(|e| format!("API request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let extracted_msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v["error"]["message"].as_str().map(|s| s.to_string())
                    .or_else(|| v["error"].as_str().map(|s| s.to_string()))
                    .or_else(|| v["message"].as_str().map(|s| s.to_string()))
            })
            .unwrap_or_else(|| text.clone());
        return Err(format!("LLM Provider Error ({}): {}", status.as_u16(), extracted_msg));
    }

    on_event(StreamEventPayload::Status {
        stage: "connected".into(),
    });

    let mut think_filter = ThinkFilter::new();
    let mut usage = UsageInfo::default();
    let mut usage_json = String::new();
    let mut model_used: Option<String> = None;
    let mut saw_reasoning_field = false;

    use futures_util::StreamExt;
    let mut byte_stream = response.bytes_stream();
    let mut buffer = String::new();

    loop {
        let chunk_res = tokio::time::timeout(
            std::time::Duration::from_secs(90),
            byte_stream.next(),
        ).await;

        let chunk = match chunk_res {
            Ok(Some(Ok(c))) => c,
            Ok(Some(Err(e))) => return Err(format!("API stream read failed: {}", e)),
            Ok(None) => break,
            Err(_) => return Err("LLM stream timed out after 90 seconds of inactivity.".into()),
        };

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
                let (full_text, reasoning_text) = think_filter.finish(&mut on_event);
                return Ok((full_text, reasoning_text, usage, usage_json, model_used));
            }

            let json: serde_json::Value = match serde_json::from_str(payload) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if model_used.is_none() {
                model_used = json["model"].as_str().map(|s| s.to_string());
            }
            if !json["usage"].is_null() {
                let (u, uj) = parse_usage_value(&json["usage"], &think_filter.full_text);
                usage = u;
                usage_json = uj;
            }

            let reasoning_piece = json["choices"][0]["delta"]["reasoning_content"]
                .as_str()
                .or_else(|| json["choices"][0]["delta"]["reasoning"].as_str())
                .unwrap_or("");
            if !reasoning_piece.is_empty() {
                if !saw_reasoning_field && !think_filter.saw_reasoning {
                    saw_reasoning_field = true;
                    on_event(StreamEventPayload::Status {
                        stage: "reasoning".into(),
                    });
                }
                think_filter.reasoning_text.push_str(reasoning_piece);
                on_event(StreamEventPayload::ReasoningDelta {
                    text: reasoning_piece.to_string(),
                });
            }

            if let Some(delta) = json["choices"][0]["delta"]["content"].as_str() {
                if !delta.is_empty() {
                    think_filter.push_delta(delta, &mut on_event);
                }
            }
        }
    }

    on_event(StreamEventPayload::Done);
    let (full_text, reasoning_text) = think_filter.finish(&mut on_event);
    if full_text.is_empty() && reasoning_text.is_empty() {
        return Err("RouteLLM stream ended without any content.".into());
    }
    Ok((full_text, reasoning_text, usage, usage_json, model_used))
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
    let (base_url, api_key) = get_api_config(model)?;
    let normalized = normalize_chat_messages(messages);

    // Convert chat messages -> Responses input items. The system prompt becomes
    // `instructions`; the rest become input items with content parts.
    let mut instructions = String::new();
    let mut input_items: Vec<serde_json::Value> = Vec::new();
    for m in &normalized {
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
    let timeout_secs = if is_local_model(model) { 1800 } else { 300 };
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        client
            .post(format!("{}/responses", base_url))
            .bearer_auth(api_key)
            .json(&body)
            .send(),
    )
    .await
    .map_err(|_| format!("API connection timed out after {} seconds.", timeout_secs))?
    .map_err(|e| format!("API request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let extracted_msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v["error"]["message"].as_str().map(|s| s.to_string())
                    .or_else(|| v["error"].as_str().map(|s| s.to_string()))
                    .or_else(|| v["message"].as_str().map(|s| s.to_string()))
            })
            .unwrap_or_else(|| text.clone());
        return Err(format!("LLM Provider Error ({}): {}", status.as_u16(), extracted_msg));
    }

    on_event(StreamEventPayload::Status {
        stage: "connected".into(),
    });

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

    loop {
        let chunk_res = tokio::time::timeout(
            std::time::Duration::from_secs(90),
            byte_stream.next(),
        ).await;

        let chunk = match chunk_res {
            Ok(Some(Ok(c))) => c,
            Ok(Some(Err(e))) => return Err(format!("API stream read failed: {}", e)),
            Ok(None) => break,
            Err(_) => return Err("LLM stream timed out after 90 seconds of inactivity.".into()),
        };

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
                            on_event(StreamEventPayload::Status {
                                stage: "reasoning".into(),
                            });
                        }
                        reasoning_summary.push_str(delta);
                        on_event(StreamEventPayload::ReasoningDelta {
                            text: delta.to_string(),
                        });
                    }
                }
                "response.output_text.delta" => {
                    let delta = json["delta"].as_str().unwrap_or("");
                    if !delta.is_empty() {
                        if !saw_first_delta {
                            saw_first_delta = true;
                            on_event(StreamEventPayload::Status {
                                stage: "generating".into(),
                            });
                        }
                        full_text.push_str(delta);
                        on_event(StreamEventPayload::Delta {
                            text: delta.to_string(),
                        });
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
/// Only OpenAI reasoning families (gpt-5, o-series) are routed to the
/// Responses API (RouteLLM documents it for those). Everything else uses
/// Chat Completions; if a Responses call fails before the first token, we
/// silently retry on Chat Completions for the rest of the session.
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
                    StreamEventPayload::Delta { .. }
                    | StreamEventPayload::ReasoningDelta { .. } => {
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
                    return Err(format!(
                        "{} (stream failed mid-way; not retried to avoid duplicate output)",
                        e
                    ));
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

    let (text, reasoning, usage, usage_json, model_used) =
        chat_completion_stream(model, messages, &mut on_event).await?;
    Ok((text, reasoning, usage, usage_json, model_used))
}

#[tauri::command]
pub async fn test_local_endpoint(endpoint: String) -> Result<Vec<String>, String> {
    let endpoint = endpoint.trim().trim_end_matches('/').to_string();
    if endpoint.is_empty() {
        return Err("Endpoint URL cannot be empty.".into());
    }
    let url = if endpoint.ends_with("/v1") {
        format!("{}/models", endpoint)
    } else {
        format!("{}/v1/models", endpoint)
    };

    let client = http_client();
    let response = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Could not connect to {}: {}", url, e))?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Local server returned error {}: {}", status.as_u16(), text));
    }

    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse local server models JSON: {}", e))?;

    let models: Vec<String> = json["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    if models.is_empty() {
        return Err("Local server responded, but no models were found in data list.".into());
    }

    set_cached_local_url(endpoint);
    register_local_models(&models);
    Ok(models)
}

#[tauri::command]
pub async fn fetch_available_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut models: Vec<String> = Vec::new();

    // 1) Query local endpoint if accessible
    let local_url = {
        if let Ok(conn) = state.db.lock() {
            crate::settings::read_settings(&conn)
                .map(|s| s.local_base_url.unwrap_or_else(get_cached_local_url))
                .unwrap_or_else(|_| get_cached_local_url())
        } else {
            get_cached_local_url()
        }
    };

    let endpoint = local_url.trim().trim_end_matches('/');
    if !endpoint.is_empty() {
        let url = if endpoint.ends_with("/v1") {
            format!("{}/models", endpoint)
        } else {
            format!("{}/v1/models", endpoint)
        };
        let client = http_client();
        if let Ok(response) = client.get(&url).timeout(std::time::Duration::from_secs(3)).send().await {
            if response.status().is_success() {
                if let Ok(text) = response.text().await {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(arr) = json["data"].as_array() {
                            let local_ids: Vec<String> = arr
                                .iter()
                                .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                                .collect();
                            register_local_models(&local_ids);
                            models.extend(local_ids);
                        }
                    }
                }
            }
        }
    }

    // 2) Query RouteLLM if API key is set
    if let Ok(api_key) = crate::settings::load_api_key() {
        let client = http_client();
        if let Ok(response) = client
            .get(format!("{}/models", ROUTELLM_BASE_URL))
            .bearer_auth(api_key)
            .send()
            .await
        {
            if response.status().is_success() {
                if let Ok(text) = response.text().await {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(arr) = json["data"].as_array() {
                            for m in arr {
                                if let Some(id) = m["id"].as_str() {
                                    models.push(id.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 3) Include default Google Gemini models
    let gemini_defaults = [
        "gemini-1.5-pro",
        "gemini-1.5-flash",
        "gemini-2.0-flash-exp",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
    ];
    for m in gemini_defaults {
        if !models.contains(&m.to_string()) {
            models.push(m.to_string());
        }
    }

    models.sort();
    models.dedup();
    Ok(models)
}
