//! File-policy identities, including new files whose parent already exists.
use std::path::{Component, Path, PathBuf};

pub struct Identity {
    pub lexical: String,
    pub resolved: String,
    pub path: PathBuf,
    pub physically_resolved: bool,
}
pub fn normal(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    let raw = if let Some(rest) = raw.strip_prefix("//?/UNC/") {
        format!("//{rest}")
    } else {
        raw.strip_prefix("//?/").unwrap_or(&raw).to_owned()
    };
    if cfg!(windows) {
        raw.to_lowercase()
    } else {
        raw
    }
}
pub fn within(root: &str, target: &str) -> bool {
    target == root || target.starts_with(&(root.trim_end_matches('/').to_owned() + "/"))
}
pub fn resolve(workspace: &Path, value: &str) -> Result<Identity, String> {
    if value.is_empty() {
        return Err("FILE_PATH: empty path".into());
    }
    let input = Path::new(value);
    if cfg!(windows)
        && !input.is_absolute()
        && (input.has_root()
            || input
                .components()
                .any(|part| matches!(part, Component::Prefix(_))))
    {
        return Err("FILE_PATH: drive-relative/root-relative paths need an absolute path".into());
    }
    for component in input.components() {
        if let Component::Normal(name) = component {
            let name = name.to_string_lossy();
            if cfg!(windows) && (name.ends_with(['.', ' ']) || name.contains(':')) {
                return Err("FILE_PATH: ambiguous Windows path component".into());
            }
        }
    }
    let path = if input.is_absolute() {
        input.to_path_buf()
    } else {
        workspace.join(input)
    };
    // Policy evaluation holds the SQLite mutex. Never probe an explicit UNC or
    // device path here: even metadata can initiate network I/O. Such identities
    // can match explicit rules, but cannot earn an automatic local allowance.
    if cfg!(windows) && normal(&path).starts_with("//") {
        let mut lexical = PathBuf::new();
        for component in path.components() {
            match component {
                Component::CurDir => {}
                Component::ParentDir => {
                    lexical.pop();
                }
                other => lexical.push(other.as_os_str()),
            }
        }
        let normalized = normal(&lexical);
        return Ok(Identity {
            lexical: normalized.clone(),
            resolved: normalized,
            path,
            physically_resolved: false,
        });
    }
    // Resolve existing ancestors before appending a missing leaf. In particular,
    // a junction followed by '..' must not be authorized by a string prefix.
    let mut anchor = path.clone();
    let mut missing = vec![];
    loop {
        match std::fs::symlink_metadata(&anchor) {
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing.push(
                    anchor
                        .file_name()
                        .ok_or("FILE_PATH: unresolved ancestor")?
                        .to_owned(),
                );
                anchor = anchor
                    .parent()
                    .ok_or("FILE_PATH: unresolved root")?
                    .to_path_buf();
            }
            Err(error) => return Err(format!("FILE_PATH: cannot resolve ancestor: {error}")),
        }
    }
    let mut projected = anchor
        .canonicalize()
        .map_err(|error| format!("FILE_PATH: unresolved link/ancestor: {error}"))?;
    for name in missing.into_iter().rev() {
        projected.push(name);
    }
    Ok(Identity {
        lexical: normal(&path),
        resolved: normal(&projected),
        path,
        physically_resolved: true,
    })
}
pub fn is_reparse(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|metadata| {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return true;
                }
            }
            metadata.file_type().is_symlink()
        })
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn boundaries_and_extended_windows_prefixes_are_unambiguous() {
        assert!(within("d:/task/workspace", "d:/task/workspace/a.json"));
        assert!(!within(
            "d:/task/workspace",
            "d:/task/workspace-other/a.json"
        ));
        assert_eq!(
            normal(Path::new(r"\\?\D:\Task\Workspace")),
            if cfg!(windows) {
                "d:/task/workspace"
            } else {
                "D:/Task/Workspace"
            }
        );
    }
    #[test]
    fn new_leaves_and_parent_traversal_resolve_against_existing_ancestors() {
        let root = std::env::temp_dir().join(format!("zeus-path-check-{}", crate::db::new_id()));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let inside = resolve(&workspace, "nested/new.json").unwrap();
        assert!(within(
            &normal(&workspace.canonicalize().unwrap()),
            &inside.resolved
        ));
        let outside = resolve(&workspace, "../outside.json").unwrap();
        assert!(!within(
            &normal(&workspace.canonicalize().unwrap()),
            &outside.resolved
        ));
        std::fs::remove_dir(&workspace).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn network_paths_remain_lexical_and_cannot_be_auto_authorized() {
        let identity = resolve(
            Path::new(r"D:\workspace"),
            r"\\zeus-invalid.example\share\allowed\..\other.json",
        )
        .unwrap();
        assert!(!identity.physically_resolved);
        assert_eq!(identity.resolved, "//zeus-invalid.example/share/other.json");
        assert!(!within(
            "//zeus-invalid.example/share/allowed",
            &identity.resolved
        ));
    }
}
