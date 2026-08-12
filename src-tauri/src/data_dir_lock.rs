use std::{
    fs::{File, OpenOptions},
    io,
    path::Path,
};

const LOCK_FILE_NAME: &str = ".timekeeper.lock";

#[derive(Debug)]
pub struct DataDirectoryLock {
    file: File,
}

impl DataDirectoryLock {
    pub fn acquire(data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir)
            .map_err(|error| format!("创建应用数据目录失败: {error}"))?;
        let path = data_dir.join(LOCK_FILE_NAME);
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)
            .map_err(|error| format!("打开应用数据目录锁失败: {error}"))?;

        fs2::FileExt::try_lock_exclusive(&file).map_err(|error| {
            if error.kind() == io::ErrorKind::WouldBlock || error.raw_os_error() == Some(33) {
                "时约管家已在使用当前数据目录，请切换到已打开的窗口".to_string()
            } else {
                format!("锁定应用数据目录失败: {error}")
            }
        })?;

        Ok(Self { file })
    }
}

impl Drop for DataDirectoryLock {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn only_one_guard_can_hold_the_same_data_directory() {
        let directory = std::env::temp_dir().join(format!(
            "timekeeper-data-lock-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();

        let first = DataDirectoryLock::acquire(&directory).unwrap();
        let second = DataDirectoryLock::acquire(&directory).unwrap_err();
        assert!(second.contains("已在使用当前数据目录"));

        drop(first);
        DataDirectoryLock::acquire(&directory).unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn data_directory_lock_child_process() {
        const CHILD_MODE: &str = "TIMEKEEPER_DATA_LOCK_CHILD_MODE";
        const CHILD_DIRECTORY: &str = "TIMEKEEPER_DATA_LOCK_CHILD_DIRECTORY";
        if let Ok(mode) = std::env::var(CHILD_MODE) {
            let directory = std::path::PathBuf::from(std::env::var(CHILD_DIRECTORY).unwrap());
            let acquired = DataDirectoryLock::acquire(&directory);
            match mode.as_str() {
                "blocked" => assert!(acquired.is_err()),
                "available" => assert!(acquired.is_ok()),
                _ => panic!("unexpected child mode"),
            }
            return;
        }

        let directory = std::env::temp_dir().join(format!(
            "timekeeper-data-lock-child-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let first = DataDirectoryLock::acquire(&directory).unwrap();
        let test_binary = std::env::current_exe().unwrap();

        let blocked = Command::new(&test_binary)
            .args([
                "--exact",
                "data_dir_lock::tests::data_directory_lock_child_process",
            ])
            .env(CHILD_MODE, "blocked")
            .env(CHILD_DIRECTORY, &directory)
            .status()
            .unwrap();
        assert!(blocked.success());

        drop(first);
        let available = Command::new(test_binary)
            .args([
                "--exact",
                "data_dir_lock::tests::data_directory_lock_child_process",
            ])
            .env(CHILD_MODE, "available")
            .env(CHILD_DIRECTORY, &directory)
            .status()
            .unwrap();
        assert!(available.success());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
