use rusqlite::Connection;
use zeus_agent_lib::{chat, db, orchestrator, settings};

#[test]
fn test_parse_markdown_steps() {
    let md = r#"
# Action Plan
- [x] Step 1: Research database schema
- [ ] Step 2: Implement Rust gateway handler (in progress)
- [ ] Step 3: Verify frontend UI components
* [ ] Step 4: Run integration tests
"#;

    let steps = orchestrator::parse_markdown_steps(md);
    assert_eq!(steps.len(), 4);
    assert_eq!(steps[0].title, "Step 1: Research database schema");
    assert_eq!(steps[0].status, "completed");

    assert_eq!(steps[1].title, "Step 2: Implement Rust gateway handler");
    assert_eq!(steps[1].status, "in_progress");

    assert_eq!(steps[2].title, "Step 3: Verify frontend UI components");
    assert_eq!(steps[2].status, "pending");

    assert_eq!(steps[3].title, "Step 4: Run integration tests");
    assert_eq!(steps[3].status, "pending");
}

#[test]
fn test_parse_markdown_steps_numbered() {
    let md = r#"
1. Clone repo (done)
2. Build binary (in progress)
3. Deploy to production
"#;

    let steps = orchestrator::parse_markdown_steps(md);
    assert_eq!(steps.len(), 3);
    assert_eq!(steps[0].status, "completed");
    assert_eq!(steps[1].status, "in_progress");
    assert_eq!(steps[2].status, "pending");
}

#[test]
fn test_vision_model_schema_and_migration() {
    let conn = Connection::open_in_memory().unwrap();
    db::init_schema(&conn).expect("init_schema should succeed");

    let mut stmt = conn.prepare("PRAGMA table_info(tasks)").unwrap();
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    assert!(columns.contains(&"vision_model".to_string()), "tasks table must contain vision_model column");

    // Test creating and loading a task with vision_model default
    let now = db::now_iso();
    conn.execute(
        "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('v_task_1', 'Vision Task', 'active', ?1, ?1)",
        rusqlite::params![now],
    ).unwrap();

    let task = chat::load_task(&conn, "v_task_1").expect("Task should load");
    assert_eq!(task.vision_model, "gemini-3.8-flash");
}

#[test]
fn test_app_settings_vision_model_roundtrip() {
    let conn = Connection::open_in_memory().unwrap();
    db::init_schema(&conn).unwrap();

    let mut s = settings::read_settings(&conn).unwrap();
    assert_eq!(s.vision_model, "gemini-3.8-flash");

    s.vision_model = "local/vision-v1".to_string();
    settings::write_settings(&conn, &s).unwrap();

    let loaded = settings::read_settings(&conn).unwrap();
    assert_eq!(loaded.vision_model, "local/vision-v1");
}

#[test]
fn test_solo_master_prompt_config() {
    let prompt_solo = settings::load_master_prompt_for_config("qwen-local", false, true).unwrap();
    assert!(prompt_solo.contains("Direct Autonomous Execution"), "Solo mode prompt must contain direct autonomous instructions");
    assert!(prompt_solo.contains("analyze_visual"), "Solo mode prompt must contain analyze_visual directive");
    assert!(prompt_solo.contains("Output Compression"), "Solo mode prompt must contain output compression notice");

    let prompt_team = settings::load_master_prompt_for_config("gemini-1.5-pro", true, true).unwrap();
    assert!(prompt_team.contains("delegate_task"), "Team mode prompt must contain delegate_task directive");
    assert!(prompt_team.contains("analyze_visual"), "Team mode prompt must contain analyze_visual directive");
    assert!(prompt_team.contains("Output Compression"), "Team mode prompt must contain output compression notice");
}

#[test]
fn test_vision_effort_schema_and_roundtrip() {
    let conn = Connection::open_in_memory().unwrap();
    db::init_schema(&conn).expect("init_schema should succeed");

    let mut stmt = conn.prepare("PRAGMA table_info(tasks)").unwrap();
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    assert!(columns.contains(&"vision_effort".to_string()), "tasks table must contain vision_effort column");

    let now = db::now_iso();
    conn.execute(
        "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('v_task_eff', 'Vision Effort Task', 'active', ?1, ?1)",
        rusqlite::params![now],
    ).unwrap();

    let task = chat::load_task(&conn, "v_task_eff").expect("Task should load");
    assert_eq!(task.vision_effort, "default");

    let mut s = settings::read_settings(&conn).unwrap();
    assert_eq!(s.vision_effort, "default");
    s.vision_effort = "high".to_string();
    settings::write_settings(&conn, &s).unwrap();

    let loaded = settings::read_settings(&conn).unwrap();
    assert_eq!(loaded.vision_effort, "high");
}

#[test]
fn test_read_file_line_range_directive_parsing() {
    let raw = r#"```zeus-directive
{"type":"read_file","path":"test.txt","start_line":10,"end_line":25}
```"#;
    match orchestrator::parse_master_reply(raw) {
        orchestrator::MasterReply::Directive(_, orchestrator::Directive::ReadFile { path, start_line, end_line, limit }, _) => {
            assert_eq!(path, "test.txt");
            assert_eq!(start_line, Some(10));
            assert_eq!(end_line, Some(25));
            assert_eq!(limit, None);
        }
        _ => panic!("Expected ReadFile directive with line range"),
    }
}
