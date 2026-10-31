import { useState } from "react";
import {
  Upload,
  X,
  FileText,
  CheckCircle2,
  Library,
  Trash2
} from "lucide-react";

import { useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../../api/client";
import { Card } from "../../components/common/Card";
import { Button } from "../../components/common/Button";

import {
  useKnowledgeFiles,
  useDeleteKnowledgeFile
} from "../../hooks/useKnowledge";

export const KnowledgeUploadForm = () => {
  const [file, setFile] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const queryClient = useQueryClient();

  const {
    data: files = [],
    isLoading: filesLoading
  } = useKnowledgeFiles();

  const deleteMutation = useDeleteKnowledgeFile();

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0];

    setError(null);
    setSuccess(null);

    if (!selectedFile) {
      return;
    }

    if (selectedFile.type !== "application/pdf") {
      setFile(null);
      setDisplayName("");
      setError("Please select a valid PDF file.");
      event.target.value = "";
      return;
    }

    if (selectedFile.size > 5 * 1024 * 1024) {
      setFile(null);
      setDisplayName("");
      setError("PDF file size must not exceed 5MB.");
      event.target.value = "";
      return;
    }

    setFile(selectedFile);

    // Use the original filename without extension as the initial suggestion.
    // The user can edit this to provide a custom knowledge-base name.
    setDisplayName(
      selectedFile.name.replace(/\.pdf$/i, "").trim()
    );
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a PDF file.");
      return;
    }

    if (!displayName.trim()) {
      setError("Please enter a name for this knowledge base.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();

    formData.append("document", file);
    formData.append("displayName", displayName.trim());

    try {
      const response = await apiClient.post(
        "/knowledge/upload",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data"
          }
        }
      );

      setSuccess(
        `Successfully created "${response.data.displayName}" with ${response.data.chunksAdded} indexed knowledge chunks.`
      );

      setFile(null);
      setDisplayName("");

      queryClient.invalidateQueries({
        queryKey: ["knowledgeFiles"]
      });

      queryClient.invalidateQueries({
        queryKey: ["labels"]
      });

      queryClient.invalidateQueries({
        queryKey: ["profile-settings"]
      });
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Failed to upload document."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (doc) => {
    const name = doc.displayName || doc.fileName;

    if (
      window.confirm(
        `Are you sure you want to delete "${name}"? This will remove its knowledge from the AI and unselect it from routing rules.`
      )
    ) {
      deleteMutation.mutate(doc.documentId);
    }
  };

  const clearSelectedFile = () => {
    setFile(null);
    setDisplayName("");
    setError(null);
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
              Upload PDF documents such as FAQs, policies, product
              information, or company documents to create a knowledge base.
            </p>

            <div className="mt-6">
              {!file ? (
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 px-6 py-10 transition-colors hover:bg-slate-100/50 dark:border-slate-700 dark:bg-slate-800/30 dark:hover:bg-slate-800/50">
                  <Upload className="mb-2 h-8 w-8 text-slate-400" />

                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Click to select a PDF
                  </span>

                  <span className="mt-1 text-xs text-slate-500">
                    Maximum file size: 5MB
                  </span>

                  <input
                    type="file"
                    className="hidden"
                    accept="application/pdf"
                    onChange={handleFileChange}
                  />
                </label>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <div className="flex min-w-0 items-center space-x-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                        <FileText className="h-5 w-5" />
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
                          {file.name}
                        </p>

                        <p className="text-xs text-slate-500">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={clearSelectedFile}
                      className="ml-3 p-2 text-slate-400 transition-colors hover:text-red-500"
                      disabled={loading}
                      title="Remove selected PDF"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div>
                    <label
                      htmlFor="knowledge-display-name"
                      className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400"
                    >
                      Knowledge Base Name
                    </label>

                    <input
                      id="knowledge-display-name"
                      type="text"
                      value={displayName}
                      onChange={(event) =>
                        setDisplayName(event.target.value)
                      }
                      placeholder="Example: Company HR Policies"
                      maxLength={100}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-100 dark:focus:ring-blue-900/30"
                    />

                    <p className="mt-1 text-xs text-slate-400">
                      This name will appear in your Routing Rules.
                    </p>
                  </div>
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
                <CheckCircle2 className="mr-2 h-4 w-4 shrink-0" />
                {success}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button
                onClick={handleUpload}
                disabled={!file || !displayName.trim() || loading}
                className="min-w-[120px]"
              >
                {loading ? "Processing..." : "Upload & Learn"}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
          Uploaded Knowledge Bases
        </h3>

        {filesLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading knowledge bases...
          </p>
        ) : files.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No knowledge bases uploaded yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {files.map((doc) => (
              <li
                key={doc.documentId}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <FileText className="h-4 w-4" />
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {doc.displayName || doc.fileName}
                    </p>

                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {doc.chunks} indexed chunks
                    </p>

                    {doc.displayName &&
                      doc.fileName &&
                      doc.displayName !== doc.fileName && (
                        <p className="truncate text-xs text-slate-400">
                          Source file: {doc.fileName}
                        </p>
                      )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(doc)}
                  disabled={deleteMutation.isPending}
                  className="shrink-0 rounded-md p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  title="Remove knowledge base"
                  aria-label={`Delete ${doc.displayName || doc.fileName}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {deleteMutation.error && (
          <p className="mt-3 text-sm text-rose-500">
            {deleteMutation.error.response?.data?.message ||
              "Could not delete knowledge base."}
          </p>
        )}
      </Card>
    </div>
  );
};