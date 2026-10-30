//! A job is established before the trusted service is allowed to start children.
//! Its handle is never given to an actor or selected by a saved/reused PID.
#[cfg(windows)]
pub struct ProcessTree(isize);

#[cfg(windows)]
impl ProcessTree {
    pub fn attach(child: &tokio::process::Child) -> Result<Self, String> {
        use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(format!(
                    "BROWSER_CONTAINMENT: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let process = match child.raw_handle() {
                Some(handle) => handle,
                None => {
                    CloseHandle(handle);
                    return Err("BROWSER_CONTAINMENT: missing process handle".into());
                }
            };
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, process as _) == 0
            {
                let error = std::io::Error::last_os_error();
                CloseHandle(handle);
                return Err(format!("BROWSER_CONTAINMENT: {error}"));
            }
            Ok(Self(handle as isize))
        }
    }
    pub fn terminate(&self) {
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0 as _, 1);
        }
    }
    pub fn active(&self) -> Result<u32, String> {
        use windows_sys::Win32::System::JobObjects::*;
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            QueryInformationJobObject(
                self.0 as _,
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as _,
                std::mem::size_of_val(&info) as u32,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(format!(
                "BROWSER_CONTAINMENT: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(info.ActiveProcesses)
    }
}
#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}

// Fail explicitly rather than claiming direct-child killing contains a tree.
#[cfg(not(windows))]
pub struct ProcessTree;
#[cfg(not(windows))]
impl ProcessTree {
    pub fn attach(_: &tokio::process::Child) -> Result<Self, String> {
        Err("BROWSER_CONTAINMENT_UNSUPPORTED: managed browser currently requires Windows".into())
    }
    pub fn terminate(&self) {}
    pub fn active(&self) -> Result<u32, String> {
        Ok(0)
    }
}
