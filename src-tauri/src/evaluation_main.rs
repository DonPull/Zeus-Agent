// Separate executable so tests never replace/terminate the user's running app.
// It runs the same production runtime and authorization path.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { zeus_agent_lib::run(); }
