/**
 * draftEditorReducer.js
 * Pure reducer and helpers for single source of truth draft editor state.
 */

export const areRecipientsEqual = (a = [], b = []) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const emailA = (a[i]?.email || "").trim().toLowerCase();
    const emailB = (b[i]?.email || "").trim().toLowerCase();
    const nameA = (a[i]?.name || "").trim();
    const nameB = (b[i]?.name || "").trim();
    if (emailA !== emailB || nameA !== nameB) {
      return false;
    }
  }
  return true;
};

export const computeDirty = (current, initial, pendingPreview, source) => {
  if (pendingPreview) return true;
  if (source === "restore" && (current.body ?? "") !== (initial.body ?? "")) {
    return true;
  }
  if ((current.body ?? "") !== (initial.body ?? "")) return true;
  if ((current.subject ?? "") !== (initial.subject ?? "")) return true;
  if (!areRecipientsEqual(current.to, initial.to)) return true;
  if (!areRecipientsEqual(current.cc, initial.cc)) return true;
  if (!areRecipientsEqual(current.bcc, initial.bcc)) return true;
  return false;
};

export const initialEditorState = {
  to: [],
  cc: [],
  bcc: [],
  subject: "",
  body: "",
  baseVersionId: null,
  initialDraft: {
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    body: "",
  },
  dirty: false,
  pendingPreview: null,
  source: "manual_edit", // 'manual_edit' | 'ai_revision' | 'restore'
  conflict: null, // { message, currentVersionId, ... }
  showDiscardConfirm: false,
  syncStatus: null, // { state: 'synced'|'failed'|'pending', reason: string, at: Date }
  notice: null, // aria-live feedback message
};

export const draftEditorReducer = (state, action) => {
  switch (action.type) {
    case "INIT": {
      const {
        to = [],
        cc = [],
        bcc = [],
        subject = "",
        body = "",
        baseVersionId = null,
        syncStatus = null,
      } = action.payload || {};

      const initialDraft = {
        to: Array.isArray(to) ? [...to] : [],
        cc: Array.isArray(cc) ? [...cc] : [],
        bcc: Array.isArray(bcc) ? [...bcc] : [],
        subject: subject || "",
        body: body || "",
      };

      return {
        ...state,
        to: [...initialDraft.to],
        cc: [...initialDraft.cc],
        bcc: [...initialDraft.bcc],
        subject: initialDraft.subject,
        body: initialDraft.body,
        baseVersionId: baseVersionId || null,
        initialDraft,
        dirty: false,
        pendingPreview: null,
        source: "manual_edit",
        conflict: null,
        showDiscardConfirm: false,
        syncStatus: syncStatus || null,
        notice: null,
      };
    }

    case "UPDATE_FIELD": {
      const { field, value } = action.payload;
      const updated = {
        ...state,
        [field]: value,
      };
      const dirty = computeDirty(
        updated,
        state.initialDraft,
        state.pendingPreview,
        state.source
      );
      return {
        ...updated,
        dirty,
        conflict: null,
        notice: null,
      };
    }

    case "SET_AI_PREVIEW": {
      const preview = action.payload;
      return {
        ...state,
        body: preview.body,
        pendingPreview: preview,
        source: "ai_revision",
        dirty: true,
        conflict: null,
        notice: null,
      };
    }

    case "ACCEPT_PREVIEW": {
      // "Use this": clears the preview banner, keeps the text, keeps dirty: true
      return {
        ...state,
        pendingPreview: null,
        source: "ai_revision",
        dirty: true,
      };
    }

    case "DISCARD_PREVIEW": {
      const previousBody =
        state.pendingPreview?.previousBody ?? state.initialDraft.body;
      const updated = {
        ...state,
        body: previousBody,
        pendingPreview: null,
        source: "manual_edit",
      };
      const dirty = computeDirty(
        updated,
        state.initialDraft,
        null,
        "manual_edit"
      );
      return {
        ...updated,
        dirty,
      };
    }

    case "RESTORE_VERSION": {
      const version = action.payload;
      const restoredBody = version?.body ?? "";
      const isDifferent = restoredBody !== state.initialDraft.body;
      const updated = {
        ...state,
        body: restoredBody,
        source: isDifferent ? "restore" : "manual_edit",
        pendingPreview: null,
      };
      const dirty = computeDirty(
        updated,
        state.initialDraft,
        null,
        updated.source
      );
      return {
        ...updated,
        dirty,
        conflict: null,
        notice: null,
      };
    }

    case "UNDO": {
      if (state.pendingPreview) {
        const previousBody =
          state.pendingPreview.previousBody ?? state.initialDraft.body;
        const updated = {
          ...state,
          body: previousBody,
          pendingPreview: null,
          source: "manual_edit",
        };
        const dirty = computeDirty(
          updated,
          state.initialDraft,
          null,
          "manual_edit"
        );
        return {
          ...updated,
          dirty,
        };
      }
      if (action.payload?.version) {
        const targetBody = action.payload.version.body ?? "";
        const isDifferent = targetBody !== state.initialDraft.body;
        const updated = {
          ...state,
          body: targetBody,
          source: isDifferent ? "restore" : "manual_edit",
          pendingPreview: null,
        };
        const dirty = computeDirty(
          updated,
          state.initialDraft,
          null,
          updated.source
        );
        return {
          ...updated,
          dirty,
        };
      }
      return state;
    }

    case "MARK_SAVED": {
      const { newVersionId, syncStatus, notice } = action.payload || {};
      const currentDraft = {
        to: [...state.to],
        cc: [...state.cc],
        bcc: [...state.bcc],
        subject: state.subject,
        body: state.body,
      };
      return {
        ...state,
        initialDraft: currentDraft,
        baseVersionId: newVersionId || state.baseVersionId,
        dirty: false,
        pendingPreview: null,
        source: "manual_edit",
        conflict: null,
        showDiscardConfirm: false,
        syncStatus: syncStatus || { state: "synced" },
        notice: notice || "Draft saved",
      };
    }

    case "DISCARD_CHANGES": {
      return {
        ...state,
        to: [...state.initialDraft.to],
        cc: [...state.initialDraft.cc],
        bcc: [...state.initialDraft.bcc],
        subject: state.initialDraft.subject,
        body: state.initialDraft.body,
        dirty: false,
        pendingPreview: null,
        source: "manual_edit",
        conflict: null,
        showDiscardConfirm: false,
        notice: null,
      };
    }

    case "SET_DISCARD_CONFIRM": {
      return {
        ...state,
        showDiscardConfirm: Boolean(action.payload),
      };
    }

    case "SET_CONFLICT": {
      return {
        ...state,
        conflict: action.payload,
      };
    }

    case "CLEAR_CONFLICT": {
      return {
        ...state,
        conflict: null,
      };
    }

    case "SET_SYNC_STATUS": {
      return {
        ...state,
        syncStatus: action.payload,
      };
    }

    case "SET_NOTICE": {
      return {
        ...state,
        notice: action.payload,
      };
    }

    default:
      return state;
  }
};
