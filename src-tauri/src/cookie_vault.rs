use tauri::State;
use crate::db::{AppState, CookieVaultEntry, list_cookie_vault, save_cookie_vault_entry, delete_cookie_vault_entry, get_cookie_vault_entry};

#[tauri::command]
pub async fn get_vault_accounts(
    state: State<'_, AppState>,
    domain: Option<String>,
) -> Result<Vec<CookieVaultEntry>, String> {
    let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    list_cookie_vault(&conn, domain.as_deref()).map_err(|e| format!("Failed to list cookie vault: {}", e))
}

#[tauri::command]
pub async fn get_vault_account(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<CookieVaultEntry>, String> {
    let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    get_cookie_vault_entry(&conn, &id).map_err(|e| format!("Failed to get vault account: {}", e))
}

#[tauri::command]
pub async fn save_vault_account(
    state: State<'_, AppState>,
    entry: CookieVaultEntry,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    save_cookie_vault_entry(&conn, &entry).map_err(|e| format!("Failed to save cookie vault entry: {}", e))
}

#[tauri::command]
pub async fn delete_vault_account(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    delete_cookie_vault_entry(&conn, &id).map_err(|e| format!("Failed to delete cookie vault entry: {}", e))
}
