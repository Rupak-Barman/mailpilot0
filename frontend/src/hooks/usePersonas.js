import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPersonas, createPersona, updatePersona, deletePersona } from "../api/personas.api";
export const usePersonas = () => useQuery({ queryKey: ["personas"], queryFn: getPersonas });
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ["personas"] }); qc.invalidateQueries({ queryKey: ["labels"] }); qc.invalidateQueries({ queryKey: ["profile-settings"] }); };
export const useCreatePersona = () => { const qc=useQueryClient(); return useMutation({ mutationFn:createPersona, onSuccess:()=>refresh(qc) }); };
export const useUpdatePersona = () => { const qc=useQueryClient(); return useMutation({ mutationFn:updatePersona, onSuccess:()=>refresh(qc) }); };
export const useDeletePersona = () => { const qc=useQueryClient(); return useMutation({ mutationFn:deletePersona, onSuccess:()=>refresh(qc) }); };
