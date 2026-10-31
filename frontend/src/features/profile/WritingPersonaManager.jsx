import { useState } from "react";
import { Card } from "../../components/common/Card";
import { Input, Select, Textarea } from "../../components/common/FormControls";
import { Button } from "../../components/common/Button";
import { usePersonas, useCreatePersona, useUpdatePersona, useDeletePersona } from "../../hooks/usePersonas";
const blank={name:"",tone:"friendly",instructions:"",signature:""};
export const WritingPersonaManager=()=>{
 const {data:personas=[],isLoading}=usePersonas(); const [form,setForm]=useState(blank); const [editing,setEditing]=useState("");
 const create=useCreatePersona(), update=useUpdatePersona(), remove=useDeletePersona();
 const save=()=>{if(!form.name.trim())return; const done=()=>{setForm(blank);setEditing("")}; if(editing) update.mutate({personaId:editing,payload:form},{onSuccess:done}); else create.mutate(form,{onSuccess:done});};
 const edit=(p)=>{setEditing(p._id);setForm({name:p.name||"",tone:p.tone||"friendly",instructions:p.instructions||"",signature:p.signature||""})};
 return <Card className="space-y-4 p-4"><div><h2 className="font-semibold text-slate-900 dark:text-slate-100">Writing Personas</h2><p className="mt-1 text-sm text-slate-500">Create different writing styles and assign one to each routing rule.</p></div>
 <div className="grid gap-3 md:grid-cols-2"><div><label className="text-xs font-semibold uppercase text-slate-400">Persona name</label><Input className="mt-1" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Professional" /></div><div><label className="text-xs font-semibold uppercase text-slate-400">Tone</label><Select className="mt-1" value={form.tone} onChange={e=>setForm({...form,tone:e.target.value})}>{["friendly","formal","casual","technical"].map(x=><option key={x} value={x}>{x[0].toUpperCase()+x.slice(1)}</option>)}</Select></div><div className="md:col-span-2"><label className="text-xs font-semibold uppercase text-slate-400">Writing instructions</label><Textarea className="mt-1" value={form.instructions} onChange={e=>setForm({...form,instructions:e.target.value})} placeholder="Be concise, confident, and polite..." /></div><div className="md:col-span-2"><label className="text-xs font-semibold uppercase text-slate-400">Signature (optional)</label><Input className="mt-1" value={form.signature} onChange={e=>setForm({...form,signature:e.target.value})} placeholder="Best regards, ..." /></div></div>
 <div className="flex gap-2"><Button onClick={save} disabled={create.isPending||update.isPending}>{editing?"Save changes":"Add persona"}</Button>{editing&&<Button variant="subtle" onClick={()=>{setEditing("");setForm(blank)}}>Cancel</Button>}</div>
 {(create.error||update.error)&&<p className="text-sm text-rose-500">{create.error?.response?.data?.message||update.error?.response?.data?.message||"Could not save persona"}</p>}
 <div className="space-y-2">{isLoading?<p className="text-sm text-slate-500">Loading personas…</p>:personas.map(p=><div key={p._id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{p.name} <span className="text-xs text-slate-500">· {p.tone}</span></p><p className="mt-1 text-sm text-slate-500">{p.instructions||"No custom instructions"}</p></div><div className="flex gap-2"><Button onClick={()=>edit(p)}>Edit</Button><Button onClick={()=>{if(window.confirm(`Delete persona “${p.name}”?`))remove.mutate(p._id)}}>Delete</Button></div></div>)}</div>
 </Card>;
};
