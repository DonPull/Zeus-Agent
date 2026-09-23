use rusqlite::Connection;
use zeus_agent_lib::{db, settings, chat};

#[test]
fn test_sqlite_schema_and_migration_with_effort_columns() {
    // 1. Fresh schema test
    let conn = Connection::open_in_memory().unwrap();
    db::init_schema(&conn).expect("init_schema should succeed");

    let mut stmt = conn.prepare("PRAGMA table_info(tasks)").unwrap();
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    assert!(columns.contains(&"master_effort".to_string()), "tasks table must contain master_effort");
    assert!(columns.contains(&"worker_effort".to_string()), "tasks table must contain worker_effort");
    assert!(columns.contains(&"verifier_effort".to_string()), "tasks table must contain verifier_effort");
    assert!(columns.contains(&"watcher_effort".to_string()), "tasks table must contain watcher_effort");

    // 2. Legacy schema migration test
    let legacy_conn = Connection::open_in_memory().unwrap();
    legacy_conn.execute(
        "CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            budget_credits INTEGER NOT NULL DEFAULT 1000,
            spent_credits REAL NOT NULL DEFAULT 0.0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            master_model TEXT NOT NULL DEFAULT 'gemini-1.5-pro',
            worker_model TEXT NOT NULL DEFAULT 'gemini-1.5-pro',
            verifier_model TEXT NOT NULL DEFAULT 'gemini-1.5-pro',
            watcher_model TEXT NOT NULL DEFAULT 'grok-4.5',
            browser_mode TEXT NOT NULL DEFAULT 'sandboxed',
            browser_executable_path TEXT
        )",
        [],
    ).unwrap();

    // Insert a legacy row before migration
    legacy_conn.execute(
        "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('legacy_task_1', 'Legacy Task', 'active', '2026-01-01', '2026-01-01')",
        [],
    ).unwrap();

    // Run init_schema on legacy db
    db::init_schema(&legacy_conn).expect("init_schema should migrate legacy tables cleanly");

    let task = chat::load_task(&legacy_conn, "legacy_task_1").expect("Legacy task should load");
    assert_eq!(task.master_effort, "default");
    assert_eq!(task.worker_effort, "default");
    assert_eq!(task.verifier_effort, "default");
    assert_eq!(task.watcher_effort, "default");
}

#[test]
fn test_app_settings_effort_roundtrip() {
    let conn = Connection::open_in_memory().unwrap();
    db::init_schema(&conn).unwrap();

    // Check defaults
    let initial_settings = settings::read_settings(&conn).unwrap();
    assert_eq!(initial_settings.master_effort, "default");
    assert_eq!(initial_settings.worker_effort, "default");
    assert_eq!(initial_settings.verifier_effort, "default");
    assert_eq!(initial_settings.watcher_effort, "default");

    // Update settings with custom effort levels
    let mut modified_settings = initial_settings.clone();
    modified_settings.master_effort = "high".to_string();
    modified_settings.worker_effort = "low".to_string();
    modified_settings.verifier_effort = "medium".to_string();
    modified_settings.watcher_effort = "low".to_string();

    settings::write_settings(&conn, &modified_settings).expect("write_settings should succeed");

    // Read back and verify persistence
    let reloaded = settings::read_settings(&conn).unwrap();
    assert_eq!(reloaded.master_effort, "high");
    assert_eq!(reloaded.worker_effort, "low");
    assert_eq!(reloaded.verifier_effort, "medium");
    assert_eq!(reloaded.watcher_effort, "low");
}

#[test]
fn test_task_settings_effort_update_and_load() {
    let conn = Connection::open_in_memory().unwrap();
    db::init_schema(&conn).unwrap();

    conn.execute(
        "INSERT INTO tasks (id, title, status, budget_credits, spent_credits, created_at, updated_at, master_model, worker_model, verifier_model, watcher_model, browser_mode, master_effort, worker_effort, verifier_effort, watcher_effort)
         VALUES ('t_effort_1', 'Test Task', 'active', 500, 0.0, '2026-09-09', '2026-09-09', 'zai-org/GLM-5.3-Flash', 'gpt-5.6-luna', 'zai-org/GLM-5.3-Flash', 'deepseek-ai/DeepSeek-V4-Flash-0731', 'sandboxed', 'high', 'low', 'medium', 'low')",
        [],
    ).unwrap();

    let task = chat::load_task(&conn, "t_effort_1").unwrap();
    assert_eq!(task.master_model, "zai-org/GLM-5.3-Flash");
    assert_eq!(task.worker_model, "gpt-5.6-luna");
    assert_eq!(task.verifier_model, "zai-org/GLM-5.3-Flash");
    assert_eq!(task.watcher_model, "deepseek-ai/DeepSeek-V4-Flash-0731");
    assert_eq!(task.master_effort, "high");
    assert_eq!(task.worker_effort, "low");
    assert_eq!(task.verifier_effort, "medium");
    assert_eq!(task.watcher_effort, "low");

    // Update the task effort settings
    conn.execute(
        "UPDATE tasks SET master_effort = ?1, worker_effort = ?2, verifier_effort = ?3, watcher_effort = ?4 WHERE id = ?5",
        rusqlite::params!["medium", "high", "high", "default", "t_effort_1"],
    ).unwrap();

    let updated_task = chat::load_task(&conn, "t_effort_1").unwrap();
    assert_eq!(updated_task.master_effort, "medium");
    assert_eq!(updated_task.worker_effort, "high");
    assert_eq!(updated_task.verifier_effort, "high");
    assert_eq!(updated_task.watcher_effort, "default");
}

#[test]
fn test_load_master_history_effort_directives() {
    let conn = Connection::open_in_memory().unwrap();
    db::init_schema(&conn).unwrap();

    conn.execute(
        "INSERT INTO tasks (id, title, status, budget_credits, spent_credits, created_at, updated_at, master_model, worker_model, verifier_model, watcher_model, browser_mode)
         VALUES ('t_prompt_1', 'Prompt Test', 'active', 100, 0.0, '2026-09-09', '2026-09-09', 'local:qwen', 'local:qwen', 'local:qwen', 'local:qwen', 'sandboxed')",
        [],
    ).unwrap();

    // 1. Low effort
    let hist_low = chat::load_master_history(&conn, "t_prompt_1", "local:qwen", Some("low")).unwrap();
    assert!(hist_low[0].content.contains("[REASONING EFFORT: LOW]"));

    // 2. Medium effort
    let hist_med = chat::load_master_history(&conn, "t_prompt_1", "local:qwen", Some("medium")).unwrap();
    assert!(hist_med[0].content.contains("[REASONING EFFORT: MEDIUM]"));

    // 3. High effort
    let hist_high = chat::load_master_history(&conn, "t_prompt_1", "local:qwen", Some("high")).unwrap();
    assert!(hist_high[0].content.contains("[REASONING EFFORT: HIGH]"));

    // 4. Default effort (no directive appended)
    let hist_def = chat::load_master_history(&conn, "t_prompt_1", "local:qwen", Some("default")).unwrap();
    assert!(!hist_def[0].content.contains("[REASONING EFFORT:"));

    // 5. None effort (no directive appended)
    let hist_none = chat::load_master_history(&conn, "t_prompt_1", "local:qwen", None).unwrap();
    assert!(!hist_none[0].content.contains("[REASONING EFFORT:"));
}

