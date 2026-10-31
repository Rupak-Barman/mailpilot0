import { useState } from "react";
import { Upload, X, FileText, CheckCircle2, Library, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { Card } from "../../components/common/Card";
import { Button } from "../../components/common/Button";
import { useKnowledgeFiles, useDeleteKnowledgeFile } from "../../hooks/useKnowledge";

export const KnowledgeUploadForm = () => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  const queryClient = useQueryClient();
  const { data: files = [], isLoading: filesLoading } = useKnowledgeFiles();
  const deleteMutation = useDeleteKnowledgeFile();

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setError(null);
    setSuccess(null);
    if (selectedFile && selectedFile.type === "application/pdf") {
      setFile(selectedFile);
    } else {
      setFile(null);
      setError("Please select a valid PDF file.");
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append("document", file);

    try {
      const response = await apiClient.post("/knowledge/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setSuccess(`Successfully uploaded and indexed ${response.data.chunksAdded} knowledge chunks!`);
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["knowledgeFiles"] });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to upload document.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (doc) => {
    if (window.confirm(`Are you sure you want to delete "${doc.fileName}"? This will remove its knowledge from the AI and unselect it from routing rules.`)) {
      deleteMutation.mutate(doc.documentId);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-400/15 dark:text-blue-200">
            <Library className="h-4 w-4" />
          </div>
          
          <div className="flex-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Upload Knowledge
            </h2>
            <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-400">
              Upload PDF documents (like FAQs or Policies) to teach the AI facts about your business.
            </p>

            <div className="mt-6">
              {!file ? (
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 px-6 py-10 transition-colors hover:bg-slate-100/50 dark:border-slate-700 dark:bg-slate-800/30 dark:hover:bg-slate-800/50">
                  <Upload className="mb-2 h-8 w-8 text-slate-400" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Click to select a PDF
                  </span>
                  <span className="mt-1 text-xs text-slate-500">Maximum file size: 5MB</span>
                  <input
                    type="file"
                    className="hidden"
                    accept="application/pdf"
                    onChange={handleFileChange}
                  />
                </label>
              ) : (
                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                  <div className="flex items-center space-x-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                        {file.name}
                      </p>
                      <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setFile(null)}
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                    disabled={loading}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}

            {success && (
              <div className="mt-4 flex items-center rounded-md bg-green-50 p-3 text-sm text-green-600 dark:bg-green-900/20 dark:text-green-400">
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {success}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button
                onClick={handleUpload}
                disabled={!file || loading}
                className="min-w-[120px]"
              >
                {loading ? "Processing..." : "Upload & Learn"}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Uploaded Files List */}
      <Card className="p-4">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-4">
          Uploaded Documents
        </h3>
        
        {filesLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading documents...</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No documents uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {files.map((f) => (
              <li key={f.documentId} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{f.fileName}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{f.chunks} indexed chunks</p>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(f.documentId ? f : { documentId: f.fileName, fileName: f.fileName })}
                  disabled={deleteMutation.isPending}
                  className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  title="Remove document"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};
