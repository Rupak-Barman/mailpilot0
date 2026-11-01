import { useReducer, useCallback } from "react";
import {
  draftEditorReducer,
  initialEditorState,
} from "./draftEditorReducer";

export { areRecipientsEqual, computeDirty, initialEditorState } from "./draftEditorReducer";

export function useDraftEditor(initialConfig = null) {
  const [state, dispatch] = useReducer(
    draftEditorReducer,
    initialEditorState,
    (baseState) => {
      if (!initialConfig) return baseState;
      return draftEditorReducer(baseState, {
        type: "INIT",
        payload: initialConfig,
      });
    }
  );

  const init = useCallback((config) => {
    dispatch({ type: "INIT", payload: config });
  }, []);

  const updateField = useCallback((field, value) => {
    dispatch({ type: "UPDATE_FIELD", payload: { field, value } });
  }, []);

  const setAiPreview = useCallback((preview) => {
    dispatch({ type: "SET_AI_PREVIEW", payload: preview });
  }, []);

  const acceptPreview = useCallback(() => {
    dispatch({ type: "ACCEPT_PREVIEW" });
  }, []);

  const discardPreview = useCallback(() => {
    dispatch({ type: "DISCARD_PREVIEW" });
  }, []);

  const restoreVersion = useCallback((version) => {
    dispatch({ type: "RESTORE_VERSION", payload: version });
  }, []);

  const undo = useCallback((previousVersion) => {
    dispatch({ type: "UNDO", payload: { version: previousVersion } });
  }, []);

  const markSaved = useCallback(({ newVersionId, syncStatus, notice }) => {
    dispatch({
      type: "MARK_SAVED",
      payload: { newVersionId, syncStatus, notice },
    });
  }, []);

  const discardChanges = useCallback(() => {
    dispatch({ type: "DISCARD_CHANGES" });
  }, []);

  const setDiscardConfirm = useCallback((show) => {
    dispatch({ type: "SET_DISCARD_CONFIRM", payload: show });
  }, []);

  const setConflict = useCallback((conflict) => {
    dispatch({ type: "SET_CONFLICT", payload: conflict });
  }, []);

  const clearConflict = useCallback(() => {
    dispatch({ type: "CLEAR_CONFLICT" });
  }, []);

  const setSyncStatus = useCallback((syncStatus) => {
    dispatch({ type: "SET_SYNC_STATUS", payload: syncStatus });
  }, []);

  const setNotice = useCallback((notice) => {
    dispatch({ type: "SET_NOTICE", payload: notice });
  }, []);

  return {
    state,
    dispatch,
    init,
    updateField,
    setAiPreview,
    acceptPreview,
    discardPreview,
    restoreVersion,
    undo,
    markSaved,
    discardChanges,
    setDiscardConfirm,
    setConflict,
    clearConflict,
    setSyncStatus,
    setNotice,
  };
}
