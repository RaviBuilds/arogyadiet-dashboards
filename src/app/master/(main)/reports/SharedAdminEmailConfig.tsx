"use client";

import { useState, useEffect, useTransition } from "react";
import { Mail, Save, SendHorizonal, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getSharedAdminEmail,
  updateSharedAdminEmail,
  sendTestEmailToSharedAdmin,
} from "@/actions/master-actions/notificationSettingsActions";

export default function SharedAdminEmailConfig() {
  const [email, setEmail] = useState("");
  const [originalEmail, setOriginalEmail] = useState("");
  const [isSaving, startSaveTransition] = useTransition();
  const [isSending, startSendTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    async function loadEmail() {
      const savedEmail = await getSharedAdminEmail();
      setEmail(savedEmail);
      setOriginalEmail(savedEmail);
    }
    loadEmail();
  }, []);

  const handleSave = () => {
    setFeedback(null);
    startSaveTransition(async () => {
      const result = await updateSharedAdminEmail(email);
      if (result.success) {
        setOriginalEmail(email);
        setFeedback({ type: "success", message: "Email saved successfully!" });
      } else {
        setFeedback({ type: "error", message: result.error || "Failed to save." });
      }
      setTimeout(() => setFeedback(null), 4000);
    });
  };

  const handleTestEmail = () => {
    setFeedback(null);
    startSendTransition(async () => {
      const result = await sendTestEmailToSharedAdmin();
      if (result.success) {
        setFeedback({
          type: "success",
          message: `Test email sent to ${result.sentTo}`,
        });
      } else {
        setFeedback({
          type: "error",
          message: result.error || "Failed to send test email.",
        });
      }
      setTimeout(() => setFeedback(null), 5000);
    });
  };

  const hasChanges = email !== originalEmail;

  return (
    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Mail className="h-4 w-4 text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-800">
          Notification Email Configuration
        </h3>
      </div>

      <p className="text-xs text-slate-500 mb-4">
        This shared admin email is used to send all admin notifications (order alerts,
        subscription updates, failed delivery approvals, etc.) across the platform.
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@arogyadiet.com"
            className="h-10 text-sm"
          />
        </div>

        <Button
          onClick={handleSave}
          disabled={isSaving || !hasChanges || !email}
          className="gap-2 bg-slate-900 hover:bg-slate-800 text-white h-10"
        >
          {isSaving ? (
            <div className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save
        </Button>

        <Button
          onClick={handleTestEmail}
          disabled={isSending || !email}
          variant="outline"
          className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50 h-10"
        >
          {isSending ? (
            <div className="h-3.5 w-3.5 rounded-full border-2 border-blue-300 border-t-blue-700 animate-spin" />
          ) : (
            <SendHorizonal className="h-3.5 w-3.5" />
          )}
          Send Test Email
        </Button>
      </div>

      {/* Feedback message */}
      {feedback && (
        <div
          className={`mt-3 flex items-center gap-2 text-xs font-medium ${
            feedback.type === "success" ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5" />
          )}
          {feedback.message}
        </div>
      )}
    </div>
  );
}
