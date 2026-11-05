//! Opt-in, process-wide evaluation limits. Normal app execution has no gate.
//! The controller owns the environment/manifest; agent text cannot change it.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Limits {
    pub max_requests: u64,
    pub max_tokens: u64,
    pub max_in_flight: u64,
    pub max_output_tokens: u64,
    pub max_directives: u64,
    pub wall_time_ms: u64,
}

impl Limits {
    pub fn parse(raw: &str) -> Result<Self, String> {
        let value: Self = serde_json::from_str(raw).map_err(|e| format!("EVAL_CONFIG: {}", e))?;
        if value.max_requests == 0 || value.max_requests > 10_000 || value.max_tokens == 0
            || value.max_in_flight == 0 || value.max_in_flight > value.max_requests
            || value.max_output_tokens == 0 || value.max_output_tokens > value.max_tokens
            || value.max_directives == 0 || value.wall_time_ms == 0 || value.wall_time_ms > 86_400_000 {
            return Err("EVAL_CONFIG: invalid positive limits or output/concurrency allowance".into());
        }
        Ok(value)
    }
}

#[derive(Default)]
struct State {
    requests: u64, in_flight: u64, known_tokens: u64, reserved_tokens: u64,
    unknown_requests: u64, directives: u64, stop_reason: Option<String>,
}

pub struct Gate { limits: Limits, started: Instant, state: Mutex<State> }
pub struct Lease { gate: Arc<Gate>, estimate: u64, reservation: u64, observed: u64, known: bool }

#[derive(Serialize)]
pub struct Snapshot {
    limits: Limits, request_slots_used: u64, in_flight: u64, known_tokens: u64,
    reserved_token_estimate: u64, unknown_requests: u64, directives: u64,
    elapsed_ms: u128, stop_reason: Option<String>, input_estimate: &'static str,
}

impl Gate {
    fn new(limits: Limits) -> Arc<Self> { Arc::new(Self { limits, started: Instant::now(), state: Mutex::new(State::default()) }) }
    fn check(&self, state: &mut State) -> Result<(), String> {
        if self.started.elapsed() >= Duration::from_millis(self.limits.wall_time_ms) {
            state.stop_reason.get_or_insert_with(|| "deadline".into());
        }
        if let Some(reason) = &state.stop_reason { return Err(format!("EVAL_LIMIT: {}", reason)); }
        Ok(())
    }
    fn reserve(self: &Arc<Self>, body: &Value) -> Result<Lease, String> {
        // Explicit estimate, not provider pricing or an exact tokenizer count.
        let bytes = serde_json::to_vec(body).map_err(|e| e.to_string())?.len() as u64;
        let reservation = bytes.div_ceil(3).saturating_add(self.limits.max_output_tokens);
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        self.check(&mut state)?;
        let reason = if state.requests >= self.limits.max_requests { Some("requests") }
            else if state.in_flight >= self.limits.max_in_flight { Some("concurrency") }
            else if state.known_tokens.saturating_add(state.reserved_tokens).saturating_add(reservation) > self.limits.max_tokens { Some("tokens_or_reservation") }
            else { None };
        if let Some(reason) = reason { return Err(format!("EVAL_LIMIT: {}", reason)); }
        state.requests += 1; state.in_flight += 1; state.reserved_tokens += reservation;
        Ok(Lease { gate: self.clone(), estimate: reservation, reservation, observed: 0, known: false })
    }
    fn directive(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        self.check(&mut state)?;
        if state.directives >= self.limits.max_directives { return Err("EVAL_LIMIT: directives".into()); }
        state.directives += 1; Ok(())
    }
    fn remaining(&self) -> Duration { Duration::from_millis(self.limits.wall_time_ms).saturating_sub(self.started.elapsed()) }
    fn snapshot(&self) -> Result<Snapshot, String> {
        let state = self.state.lock().map_err(|e| e.to_string())?;
        Ok(Snapshot { limits: self.limits.clone(), request_slots_used: state.requests, in_flight: state.in_flight,
            known_tokens: state.known_tokens, reserved_token_estimate: state.reserved_tokens,
            unknown_requests: state.unknown_requests, directives: state.directives,
            elapsed_ms: self.started.elapsed().as_millis(), stop_reason: state.stop_reason.clone(),
            input_estimate: "serialized_request_bytes_divided_by_three_not_an_exact_tokenizer" })
    }
}

impl Lease {
    pub fn observe(&mut self, tokens: u64) -> Result<(), String> {
        let mut state = self.gate.state.lock().map_err(|e| e.to_string())?;
        state.known_tokens = state.known_tokens.saturating_sub(self.observed).saturating_add(tokens);
        self.observed = tokens; self.known = true;
        let remaining = self.estimate.saturating_sub(tokens);
        state.reserved_tokens = state.reserved_tokens.saturating_sub(self.reservation).saturating_add(remaining);
        self.reservation = remaining;
        if state.known_tokens > self.gate.limits.max_tokens {
            state.stop_reason = Some("tokens".into());
            return Err("EVAL_LIMIT: tokens".into());
        }
        Ok(())
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut state) = self.gate.state.lock() {
            state.in_flight = state.in_flight.saturating_sub(1);
            state.reserved_tokens = state.reserved_tokens.saturating_sub(self.reservation);
            if !self.known {
                state.unknown_requests += 1;
                state.stop_reason.get_or_insert_with(|| "unknown_usage".into());
            }
        }
    }
}

static GATE: OnceLock<Result<Option<Arc<Gate>>, String>> = OnceLock::new();
fn configured() -> Result<Option<Arc<Gate>>, String> {
    GATE.get_or_init(|| match std::env::var("ZEUS_EVALUATION_LIMITS") {
        Ok(raw) => Limits::parse(&raw).map(|limits| Some(Gate::new(limits))),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(format!("EVAL_CONFIG: {}", error)),
    }).clone()
}
struct CallEnvelope { output:u64, remaining:std::sync::atomic::AtomicU64 }
tokio::task_local! { static CALL_ENVELOPE: CallEnvelope; }
pub async fn bounded_call<T>(output:u64,attempts:u64,future:impl std::future::Future<Output=Result<T,String>>)->Result<T,String>{
    if output==0||attempts==0||CALL_ENVELOPE.try_with(|_|()).is_ok(){return Err("REQUEST_LIMIT: invalid or nested read-only assessment allowance".into());}
    CALL_ENVELOPE.scope(CallEnvelope{output,remaining:std::sync::atomic::AtomicU64::new(attempts)},future).await
}
pub fn reserve(body: &Value) -> Result<Option<Lease>, String> {
    if CALL_ENVELOPE.try_with(|limit|limit.remaining.fetch_update(std::sync::atomic::Ordering::SeqCst,std::sync::atomic::Ordering::SeqCst,|v|v.checked_sub(1)).is_err()).unwrap_or(false) {
        return Err("REQUEST_LIMIT: read-only assessment attempt allowance exhausted".into());
    }
    configured()?.map(|gate| gate.reserve(body)).transpose()
}
pub fn directive() -> Result<(), String> { if let Some(gate) = configured()? { gate.directive()?; } Ok(()) }
pub fn snapshot() -> Result<Option<Snapshot>, String> { configured()?.map(|gate| gate.snapshot()).transpose() }
pub fn active() -> Result<bool, String> { Ok(configured()?.is_some()) }
pub fn output_cap(body: &mut Value, responses: bool) -> Result<(), String> {
    let mut maximum=CALL_ENVELOPE.try_with(|v|v.output).ok();
    if let Some(gate) = configured()? {
        maximum=Some(maximum.map(|v|v.min(gate.limits.max_output_tokens)).unwrap_or(gate.limits.max_output_tokens));
    }
    if let Some(maximum)=maximum {body[if responses { "max_output_tokens" } else { "max_tokens" }]=maximum.into();}
    Ok(())
}
pub async fn within_deadline<T>(future: impl std::future::Future<Output = Result<T, String>>) -> Result<T, String> {
    match configured()? {
        Some(gate) => tokio::time::timeout(gate.remaining(), future).await.map_err(|_| "EVAL_LIMIT: deadline".to_string())?,
        None => future.await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn assessment_envelope_caps_both_protocols_and_prevents_a_paid_retry(){
        bounded_call(2048,1,async{
            for responses in [false,true] {
                let mut body=serde_json::json!({});
                output_cap(&mut body,responses)?;
                assert_eq!(body[if responses{"max_output_tokens"}else{"max_tokens"}],2048);
            }
            assert!(reserve(&serde_json::json!({})).is_ok());
            assert!(reserve(&serde_json::json!({})).err().unwrap().contains("REQUEST_LIMIT"));
            Ok(())
        }).await.unwrap();
        let mut outside=serde_json::json!({});output_cap(&mut outside,false).unwrap();assert!(outside.get("max_tokens").is_none());
    }
    #[tokio::test]
    async fn assessment_limits_cannot_be_empty_or_widened_by_nesting(){
        assert!(bounded_call(0,1,async{Ok(())}).await.is_err());
        bounded_call(100,1,async{
            assert!(bounded_call(200,2,async{Ok(())}).await.is_err());Ok(())
        }).await.unwrap();
    }
    fn limits() -> Limits { Limits { max_requests: 3, max_tokens: 1000, max_in_flight: 2, max_output_tokens: 100, max_directives: 2, wall_time_ms: 10000 } }
    #[test]
    fn invalid_limits_and_unknown_fields_fail_closed() {
        assert!(Limits::parse(r#"{"max_requests":0}"#).is_err());
        let mut value = serde_json::to_value(limits()).unwrap(); value["typo"] = true.into();
        assert!(Limits::parse(&value.to_string()).is_err());
    }
    #[test]
    fn roles_and_retries_share_request_slots() {
        let gate = Gate::new(limits());
        for _ in 0..3 { let mut lease = gate.reserve(&serde_json::json!({})).unwrap(); lease.observe(10).unwrap(); }
        assert!(gate.reserve(&serde_json::json!({})).is_err());
        assert_eq!(gate.snapshot().unwrap().known_tokens, 30);
    }
    #[test]
    fn concurrent_reservations_are_included_and_released() {
        let gate = Gate::new(limits());
        let mut a = gate.reserve(&serde_json::json!({})).unwrap();
        let mut b = gate.reserve(&serde_json::json!({})).unwrap();
        assert!(gate.reserve(&serde_json::json!({})).is_err());
        assert_eq!(gate.snapshot().unwrap().reserved_token_estimate, 202);
        a.observe(10).unwrap(); b.observe(20).unwrap(); drop(a); drop(b);
        let snapshot = gate.snapshot().unwrap();
        assert_eq!(snapshot.reserved_token_estimate, 0); assert_eq!(snapshot.in_flight, 0);
        assert_eq!(snapshot.known_tokens, 30);
    }
    #[test]
    fn repeated_usage_is_idempotent_and_unknown_usage_stops_further_dispatch() {
        let gate = Gate::new(limits()); let mut lease = gate.reserve(&serde_json::json!({})).unwrap();
        lease.observe(75).unwrap(); lease.observe(75).unwrap();
        assert_eq!(gate.snapshot().unwrap().reserved_token_estimate, 26);
        drop(lease);
        assert_eq!(gate.snapshot().unwrap().known_tokens, 75);
        drop(gate.reserve(&serde_json::json!({})).unwrap());
        assert_eq!(gate.snapshot().unwrap().unknown_requests, 1);
        assert!(gate.reserve(&serde_json::json!({})).is_err());
    }
    #[test]
    fn observed_overrun_is_retained_and_blocks_dispatch() {
        let gate = Gate::new(limits()); let mut lease = gate.reserve(&serde_json::json!({})).unwrap();
        assert!(lease.observe(1200).is_err()); drop(lease);
        assert_eq!(gate.snapshot().unwrap().known_tokens, 1200);
        assert!(gate.reserve(&serde_json::json!({})).is_err());
    }
    #[test]
    fn deadline_and_directive_limits_are_independent() {
        let gate = Gate::new(limits()); gate.directive().unwrap(); gate.directive().unwrap();
        assert!(gate.directive().is_err());
        let mut expired = Gate { limits: limits(), started: Instant::now() - Duration::from_secs(20), state: Mutex::new(State::default()) };
        assert!(expired.directive().is_err());
        assert_eq!(expired.state.get_mut().unwrap().stop_reason.as_deref(), Some("deadline"));
    }
}
