//! Catalogue identity stays attached to its connection, including duplicate IDs.
use serde::Serialize;
#[derive(Serialize)]
pub struct Catalogue {
    pub connection: String,
    pub status: String,
    pub models: Vec<String>,
    pub observed_at: String,
    pub error: Option<String>,
}
async fn fetch(connection: &str) -> Catalogue {
    let mut result = Catalogue {
        connection: connection.into(),
        status: "unavailable".into(),
        models: vec![],
        observed_at: crate::db::now_iso(),
        error: None,
    };
    let (base, key) = match crate::gateway::api_config_for_connection(connection) {
        Ok(config) => config,
        Err(_) => {
            result.status = "not_configured".into();
            return result;
        }
    };
    let endpoint = base.trim_end_matches('/');
    let url = format!(
        "{}/models",
        if connection == "local" && !endpoint.ends_with("/v1") {
            format!("{endpoint}/v1")
        } else {
            endpoint.into()
        }
    );
    let response = crate::gateway::http_client()
        .get(url)
        .bearer_auth(&key)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await;
    let data = match response {
        Ok(response) if response.status().is_success() => response
            .json::<serde_json::Value>()
            .await
            .map_err(|e| e.to_string()),
        Ok(response) => Err(format!(
            "Model catalogue returned HTTP {}",
            response.status().as_u16()
        )),
        Err(_) => Err("Model catalogue connection failed or timed out".into()),
    };
    match data {
        Ok(data) => {
            if let Some(models) = data["data"]
                .as_array()
                .or_else(|| data["models"].as_array())
            {
                result.models = models
                    .iter()
                    .filter_map(|model| model["id"].as_str().or_else(|| model["name"].as_str()))
                    .map(str::to_owned)
                    .collect();
                result.models.sort();
                result.models.dedup();
                result.status = "available".into();
            } else {
                result.error = Some("Catalogue did not contain a model list".into());
            }
        }
        Err(error) => result.error = Some(error),
    }
    result
}
#[tauri::command]
pub async fn fetch_model_catalogue() -> Result<Vec<Catalogue>, String> {
    if std::env::var("ZEUS_OFFLINE_TEST").as_deref() == Ok("1") {
        crate::gateway::get_api_config("phase1-mock")?;
        return Ok(vec![Catalogue {
            connection: "abacus".into(),
            status: "offline_test_adapter".into(),
            models: vec!["phase1-mock".into(), "gpt-5-nano".into()],
            observed_at: crate::db::now_iso(),
            error: None,
        }]);
    }
    let (abacus, gemini, xiaomi, local) = tokio::join!(
        fetch("abacus"),
        fetch("gemini"),
        fetch("xiaomi"),
        fetch("local")
    );
    if local.status == "available" {
        crate::gateway::register_local_models(&local.models);
    }
    if xiaomi.status == "available" {
        crate::gateway::register_xiaomi_models(&xiaomi.models);
    }
    Ok(vec![abacus, gemini, xiaomi, local])
}
