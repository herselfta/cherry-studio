import { FolderOpenOutlined, SaveOutlined } from "@ant-design/icons";
import { HStack } from "@renderer/components/Layout";
import Selector from "@renderer/components/Selector";
import { WebdavBackupManager } from "@renderer/components/WebdavBackupManager";
import {
	useWebdavBackupModal,
	WebdavBackupModal,
} from "@renderer/components/WebdavModals";
import { useTheme } from "@renderer/context/ThemeProvider";
import { useSettings } from "@renderer/hooks/useSettings";
import {
	startAutoBackup,
	stopAutoBackup,
} from "@renderer/services/BackupService";
import { useAppDispatch, useAppSelector } from "@renderer/store";
import {
	setWebdavAutoSync,
	setWebdavDisableStream as _setWebdavDisableStream,
	setWebdavHost as _setWebdavHost,
	setWebdavMaxBackups as _setWebdavMaxBackups,
	setWebdavPass as _setWebdavPass,
	setWebdavPath as _setWebdavPath,
	setWebdavSkipBackupFile as _setWebdavSkipBackupFile,
	setWebdavSyncInterval as _setWebdavSyncInterval,
	setWebdavUser as _setWebdavUser,
} from "@renderer/store/settings";
import { Button, Input, Switch } from "antd";
import type { FC } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
	SettingDivider,
	SettingGroup,
	SettingHelpText,
	SettingRow,
	SettingRowTitle,
	SettingTitle,
} from "..";
import {
	AutoSyncDescription,
	AutoSyncStatusValue,
	DEFAULT_AUTO_SYNC_INTERVAL,
	getAutoSyncIntervalOptions,
	getAutoSyncIntervalValue,
} from "./AutoSyncSettings";
import ManualSyncScheduleSettings from "./ManualSyncScheduleSettings";

const WebDavSettings: FC = () => {
	const {
		webdavHost: webDAVHost,
		webdavUser: webDAVUser,
		webdavPass: webDAVPass,
		webdavPath: webDAVPath,
		webdavAutoSync,
		webdavSyncInterval: webDAVSyncInterval,
		webdavMaxBackups: webDAVMaxBackups,
		webdavSkipBackupFile: webdDAVSkipBackupFile,
		webdavDisableStream: webDAVDisableStream,
	} = useSettings();

	const [webdavHost, setWebdavHost] = useState<string | undefined>(webDAVHost);
	const [webdavUser, setWebdavUser] = useState<string | undefined>(webDAVUser);
	const [webdavPass, setWebdavPass] = useState<string | undefined>(webDAVPass);
	const [webdavPath, setWebdavPath] = useState<string | undefined>(webDAVPath);
	const [webdavSkipBackupFile, setWebdavSkipBackupFile] = useState<boolean>(
		webdDAVSkipBackupFile,
	);
	const [webdavDisableStream, setWebdavDisableStream] =
		useState<boolean>(webDAVDisableStream);
	const [backupManagerVisible, setBackupManagerVisible] = useState(false);

	const [syncInterval, setSyncInterval] = useState<number>(webDAVSyncInterval);
	const [maxBackups, setMaxBackups] = useState<number>(webDAVMaxBackups);

	const dispatch = useAppDispatch();
	const { theme } = useTheme();

	const { t } = useTranslation();

	const { webdavSync } = useAppSelector((state) => state.backup);

	const onSyncIntervalChange = (value: number) => {
		setSyncInterval(value);
		dispatch(_setWebdavSyncInterval(value));
		if (webdavAutoSync) {
			startAutoBackup(false, "webdav");
		}
	};

	const onAutoSyncToggle = (checked: boolean) => {
		if (!checked) {
			dispatch(setWebdavAutoSync(false));
			stopAutoBackup("webdav");
			return;
		}

		const nextInterval =
			syncInterval > 0 ? syncInterval : DEFAULT_AUTO_SYNC_INTERVAL;
		setSyncInterval(nextInterval);
		dispatch(_setWebdavSyncInterval(nextInterval));
		dispatch(setWebdavAutoSync(true));
		startAutoBackup(false, "webdav");
	};

	const onMaxBackupsChange = (value: number) => {
		setMaxBackups(value);
		dispatch(_setWebdavMaxBackups(value));
	};

	const onSkipBackupFilesChange = (value: boolean) => {
		setWebdavSkipBackupFile(value);
		dispatch(_setWebdavSkipBackupFile(value));
	};

	const onDisableStreamChange = (value: boolean) => {
		setWebdavDisableStream(value);
		dispatch(_setWebdavDisableStream(value));
	};

	const {
		isModalVisible,
		handleBackup,
		handleCancel,
		backuping,
		customFileName,
		setCustomFileName,
		showBackupModal,
	} = useWebdavBackupModal();

	const showBackupManager = () => {
		setBackupManagerVisible(true);
	};

	const closeBackupManager = () => {
		setBackupManagerVisible(false);
	};

	const isSyncConfigured = Boolean(webdavHost);
	const isAutoSyncEnabled = Boolean(webdavAutoSync && syncInterval > 0);

	return (
		<SettingGroup theme={theme}>
			<SettingTitle>{t("settings.data.webdav.title")}</SettingTitle>
			<SettingDivider />
			<SettingRow>
				<SettingRowTitle>
					{t("settings.data.webdav.host.label")}
				</SettingRowTitle>
				<Input
					placeholder={t("settings.data.webdav.host.placeholder")}
					value={webdavHost}
					onChange={(e) => setWebdavHost(e.target.value)}
					style={{ width: 250 }}
					type="url"
					onBlur={() => dispatch(_setWebdavHost(webdavHost || ""))}
				/>
			</SettingRow>
			<SettingDivider />
			<SettingRow>
				<SettingRowTitle>{t("settings.data.webdav.user")}</SettingRowTitle>
				<Input
					placeholder={t("settings.data.webdav.user")}
					value={webdavUser}
					onChange={(e) => setWebdavUser(e.target.value)}
					style={{ width: 250 }}
					onBlur={() => dispatch(_setWebdavUser(webdavUser || ""))}
				/>
			</SettingRow>
			<SettingDivider />
			<SettingRow>
				<SettingRowTitle>{t("settings.data.webdav.password")}</SettingRowTitle>
				<Input.Password
					placeholder={t("settings.data.webdav.password")}
					value={webdavPass}
					onChange={(e) => setWebdavPass(e.target.value)}
					style={{ width: 250 }}
					onBlur={() => dispatch(_setWebdavPass(webdavPass || ""))}
				/>
			</SettingRow>
			<SettingDivider />
			<SettingRow>
				<SettingRowTitle>
					{t("settings.data.webdav.path.label")}
				</SettingRowTitle>
				<Input
					placeholder={t("settings.data.webdav.path.placeholder")}
					value={webdavPath}
					onChange={(e) => setWebdavPath(e.target.value)}
					style={{ width: 250 }}
					onBlur={() => dispatch(_setWebdavPath(webdavPath || ""))}
				/>
			</SettingRow>
			<SettingDivider />
			<SettingRow>
				<SettingRowTitle>
					{t("settings.data.auto_sync.manual.label")}
				</SettingRowTitle>
				<HStack gap="5px" justifyContent="space-between">
					<Button
						onClick={showBackupModal}
						icon={<SaveOutlined />}
						loading={backuping}
					>
						{t("settings.data.webdav.backup.button")}
					</Button>
					<Button
						onClick={showBackupManager}
						icon={<FolderOpenOutlined />}
						disabled={!webdavHost}
					>
						{t("settings.data.webdav.restore.button")}
					</Button>
				</HStack>
			</SettingRow>
			<SettingRow>
				<SettingHelpText>
					{t("settings.data.auto_sync.manual.help")}
				</SettingHelpText>
			</SettingRow>
			<SettingDivider />
			<ManualSyncScheduleSettings
				provider="webdav"
				isConfigured={isSyncConfigured}
			/>
			<SettingDivider />
			<SettingRow>
				<SettingRowTitle>{t("settings.data.auto_sync.label")}</SettingRowTitle>
				<Switch
					checked={isAutoSyncEnabled}
					onChange={onAutoSyncToggle}
					disabled={!isSyncConfigured}
				/>
			</SettingRow>
			<SettingDivider />
			<SettingRow>
				<SettingRowTitle>
					{t("settings.data.auto_sync.interval.label")}
				</SettingRowTitle>
				<Selector
					size={14}
					value={getAutoSyncIntervalValue(syncInterval)}
					onChange={onSyncIntervalChange}
					placeholder={t("settings.data.auto_sync.interval.placeholder")}
					disabled={!isSyncConfigured}
					options={getAutoSyncIntervalOptions(t)}
				/>
			</SettingRow>
			<SettingRow>
				<AutoSyncDescription isConfigured={isSyncConfigured} />
			</SettingRow>
			<SettingDivider />
			<SettingRow>
				<SettingRowTitle>
					{t("settings.data.webdav.maxBackups")}
				</SettingRowTitle>
				<Selector
					size={14}
					value={maxBackups}
					onChange={onMaxBackupsChange}
					disabled={!webdavHost}
					options={[
						{ label: t("settings.data.local.maxBackups.unlimited"), value: 0 },
						{ label: "1", value: 1 },
						{ label: "3", value: 3 },
						{ label: "5", value: 5 },
						{ label: "10", value: 10 },
						{ label: "20", value: 20 },
						{ label: "50", value: 50 },
					]}
				/>
			</SettingRow>
			<SettingDivider />
			<SettingRow>
				<SettingRowTitle>
					{t("settings.data.backup.skip_file_data_title")}
				</SettingRowTitle>
				<Switch
					checked={webdavSkipBackupFile}
					onChange={onSkipBackupFilesChange}
				/>
			</SettingRow>
			<SettingRow>
				<SettingHelpText>
					{t("settings.data.backup.skip_file_data_help")}
				</SettingHelpText>
			</SettingRow>
			<SettingDivider />
			<SettingRow>
				<SettingRowTitle>
					{t("settings.data.webdav.disableStream.title")}
				</SettingRowTitle>
				<Switch
					checked={webdavDisableStream}
					onChange={onDisableStreamChange}
				/>
			</SettingRow>
			<SettingRow>
				<SettingHelpText>
					{t("settings.data.webdav.disableStream.help")}
				</SettingHelpText>
			</SettingRow>
			{isAutoSyncEnabled && (
				<>
					<SettingDivider />
					<SettingRow>
						<SettingRowTitle>
							{t("settings.data.auto_sync.status.label")}
						</SettingRowTitle>
						<AutoSyncStatusValue
							isConfigured={isSyncConfigured}
							syncState={webdavSync}
						/>
					</SettingRow>
				</>
			)}
			<>
				<WebdavBackupModal
					isModalVisible={isModalVisible}
					handleBackup={handleBackup}
					handleCancel={handleCancel}
					backuping={backuping}
					customFileName={customFileName}
					setCustomFileName={setCustomFileName}
				/>

				<WebdavBackupManager
					visible={backupManagerVisible}
					onClose={closeBackupManager}
					webdavConfig={{
						webdavHost,
						webdavUser,
						webdavPass,
						webdavPath,
						webdavDisableStream,
					}}
				/>
			</>
		</SettingGroup>
	);
};

export default WebDavSettings;
