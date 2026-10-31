import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
export const useKnowledgeFiles = () => useQuery({ queryKey: ["knowledgeFiles"], queryFn: async () => (await apiClient.get("/knowledge")).data });
export const useDeleteKnowledgeFile = () => { const qc=useQueryClient(); return useMutation({ mutationFn: async (documentId) => (await apiClient.delete(`/knowledge/${encodeURIComponent(documentId)}`)).data, onSuccess:()=>{qc.invalidateQueries({queryKey:["knowledgeFiles"]});qc.invalidateQueries({queryKey:["labels"]});qc.invalidateQueries({queryKey:["profile-settings"]});} }); };
