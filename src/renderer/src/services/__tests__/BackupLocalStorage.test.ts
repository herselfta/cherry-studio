import { beforeEach, describe, expect, it } from "vitest";

import {
	BACKUP_MANUAL_SYNC_CONFIRM_PREFERENCES_KEY,
	createBackupLocalStorageSnapshot,
	MANUAL_SYNC_SCHEDULE_STORAGE_KEY,
	PERSISTED_REDUX_STATE_STORAGE_KEY,
	restoreBackupLocalStorageSnapshot,
} from "../BackupLocalStorage";

describe("BackupLocalStorage", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("only snapshots cross-device localStorage keys", () => {
		localStorage.setItem(PERSISTED_REDUX_STATE_STORAGE_KEY, "persisted-redux");
		localStorage.setItem(
			MANUAL_SYNC_SCHEDULE_STORAGE_KEY,
			JSON.stringify({
				webdav: {
					uploadTimes: ["09:00"],
					restoreTimes: ["20:00"],
					confirmBeforeRestore: false,
				},
			}),
		);
		localStorage.setItem("language", "zh-CN");
		localStorage.setItem("memory_currentUserId", "portable-user");
		localStorage.setItem("privacy-popup-accepted", "true");

		expect(createBackupLocalStorageSnapshot()).toEqual({
			[BACKUP_MANUAL_SYNC_CONFIRM_PREFERENCES_KEY]:
				'{"webdav":false,"s3":true,"local":true,"nutstore":true}',
			[PERSISTED_REDUX_STATE_STORAGE_KEY]: "persisted-redux",
			language: "zh-CN",
			memory_currentUserId: "portable-user",
		});
	});

	it("restores cross-device localStorage keys and keeps schedule times device-local", () => {
		localStorage.setItem(
			MANUAL_SYNC_SCHEDULE_STORAGE_KEY,
			JSON.stringify({
				local: {
					uploadTimes: ["11:00"],
					restoreTimes: ["22:00"],
					confirmBeforeRestore: true,
				},
			}),
		);
		localStorage.setItem("language", "en-US");
		localStorage.setItem("memory_currentUserId", "stale-user");
		localStorage.setItem("privacy-popup-accepted", "true");

		restoreBackupLocalStorageSnapshot(
			{
				[PERSISTED_REDUX_STATE_STORAGE_KEY]: "persisted-redux",
				[BACKUP_MANUAL_SYNC_CONFIRM_PREFERENCES_KEY]:
					'{"webdav":false,"s3":true,"local":false,"nutstore":true}',
			},
			{ removeMissingPortableKeys: true },
		);

		expect(localStorage.getItem(PERSISTED_REDUX_STATE_STORAGE_KEY)).toBe(
			"persisted-redux",
		);
		expect(
			JSON.parse(localStorage.getItem(MANUAL_SYNC_SCHEDULE_STORAGE_KEY) || ""),
		).toEqual({
			webdav: {
				uploadTimes: [],
				restoreTimes: [],
				confirmBeforeRestore: false,
			},
			s3: {
				uploadTimes: [],
				restoreTimes: [],
				confirmBeforeRestore: true,
			},
			local: {
				uploadTimes: ["11:00"],
				restoreTimes: ["22:00"],
				confirmBeforeRestore: false,
			},
			nutstore: {
				uploadTimes: [],
				restoreTimes: [],
				confirmBeforeRestore: true,
			},
		});
		expect(localStorage.getItem("language")).toBeNull();
		expect(localStorage.getItem("memory_currentUserId")).toBeNull();
		expect(localStorage.getItem("privacy-popup-accepted")).toBe("true");
	});

	it("keeps existing portable keys when restoring backups without the new snapshot entries", () => {
		localStorage.setItem(
			MANUAL_SYNC_SCHEDULE_STORAGE_KEY,
			JSON.stringify({
				local: {
					uploadTimes: ["11:00"],
					restoreTimes: ["22:00"],
					confirmBeforeRestore: true,
				},
			}),
		);
		localStorage.setItem("language", "zh-CN");

		restoreBackupLocalStorageSnapshot({
			[PERSISTED_REDUX_STATE_STORAGE_KEY]: "persisted-redux",
		});

		expect(localStorage.getItem(PERSISTED_REDUX_STATE_STORAGE_KEY)).toBe(
			"persisted-redux",
		);
		expect(
			JSON.parse(localStorage.getItem(MANUAL_SYNC_SCHEDULE_STORAGE_KEY) || ""),
		).toEqual({
			local: {
				uploadTimes: ["11:00"],
				restoreTimes: ["22:00"],
				confirmBeforeRestore: true,
			},
		});
		expect(localStorage.getItem("language")).toBe("zh-CN");
	});

	it("only restores confirm-before-restore from legacy manual schedule backups", () => {
		localStorage.setItem(
			MANUAL_SYNC_SCHEDULE_STORAGE_KEY,
			JSON.stringify({
				local: {
					uploadTimes: ["11:00"],
					restoreTimes: ["22:00"],
					confirmBeforeRestore: true,
				},
			}),
		);

		restoreBackupLocalStorageSnapshot({
			[PERSISTED_REDUX_STATE_STORAGE_KEY]: "persisted-redux",
			[MANUAL_SYNC_SCHEDULE_STORAGE_KEY]: JSON.stringify({
				webdav: {
					uploadTimes: ["06:00"],
					restoreTimes: ["18:00"],
					confirmBeforeRestore: false,
				},
			}),
		});

		expect(
			JSON.parse(localStorage.getItem(MANUAL_SYNC_SCHEDULE_STORAGE_KEY) || ""),
		).toEqual({
			webdav: {
				uploadTimes: [],
				restoreTimes: [],
				confirmBeforeRestore: false,
			},
			s3: {
				uploadTimes: [],
				restoreTimes: [],
				confirmBeforeRestore: true,
			},
			local: {
				uploadTimes: ["11:00"],
				restoreTimes: ["22:00"],
				confirmBeforeRestore: true,
			},
			nutstore: {
				uploadTimes: [],
				restoreTimes: [],
				confirmBeforeRestore: true,
			},
		});
	});
});
