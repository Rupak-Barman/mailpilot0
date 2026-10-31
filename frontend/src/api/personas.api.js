import { apiClient } from "./client";
export const getPersonas = async () => (await apiClient.get("/personas")).data;
export const createPersona = async (payload) => (await apiClient.post("/personas", payload)).data;
export const updatePersona = async ({ personaId, payload }) => (await apiClient.patch(`/personas/${personaId}`, payload)).data;
export const deletePersona = async (personaId) => (await apiClient.delete(`/personas/${personaId}`)).data;
