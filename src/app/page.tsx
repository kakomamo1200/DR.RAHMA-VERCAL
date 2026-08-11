"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, Clock, CheckCircle2, XCircle, LogIn, LogOut, UserPlus,
  LayoutDashboard, Shield, Plus, Trash2, Edit3, Upload, FileText,
  ChevronLeft, BarChart3, Timer,
  AlertTriangle, Eye, Play, Save, Send, Menu, X,
  FolderOpen, HelpCircle, Award, Users, Download
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// ============ Types ============
type User = { id: string; email: string; name: string | null; role: string };
type Subject = { id: string; name: string; description: string | null; quizCount: number; pendingQuizzes: number; quizzes: Quiz[] };
type Quiz = { id: string; title: string; description: string | null; durationMinutes: number; startDate?: string | null; endDate?: string | null; questionCount: number; attemptCount: number; subjectName: string; order: number; status: string | null };
type QuizQuestion = { id: string; text: string; passage?: string | null; type?: "mcq" | "true_false"; imageUrl: string | null; points: number; choices: string[] };
type ReviewQuestion = { id: string; text: string; passage?: string | null; type?: "mcq" | "true_false"; imageUrl: string | null; points: number; choices: { id: string; text: string; isCorrect: boolean }[]; correct: number; picked: number | null };
type AttemptResult = { id: string; score: number; totalPoints: number; startedAt: string; submittedAt: string; quiz: { id: string; title: string; subjectName: string }; percent: number; userName?: string | null };
type ImportQuestion = { text: string; passage?: string | null; type?: "mcq" | "true_false"; imageUrl: string | null; choices: { text: string; isCorrect: boolean }[] };

type View = "home" | "subject" | "quiz" | "dashboard" | "admin" | "auth";

// ============ API Helper ============
async function api(path: string, options?: RequestInit) {
  const token = typeof window !== "undefined" ? localStorage.getItem("quiz_token") : null;
  const res = await fetch(path, {
    ...options,
    headers: {
      ...options?.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    },
  });
  return res.json();
}

// ============ Main Component ============
export default function QuizBank() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("home");
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Data states
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [currentSubject, setCurrentSubject] = useState<Subject | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [attempts, setAttempts] = useState<AttemptResult[]>([]);

  // Quiz running state
  const [quizData, setQuizData] = useState<{ quiz: { id: string; title: string; description: string | null; durationMinutes: number }; questions: QuizQuestion[] } | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<(number | null)[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [quizStarted, setQuizStarted] = useState(false);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizStartTime, setQuizStartTime] = useState(0);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [reviewData, setReviewData] = useState<{ score: number; totalPoints: number; percent: number; questions: ReviewQuestion[] } | null>(null);

  // Auth form state
  const [authMode, setAuthMode] = useState<"login" | "register" | "reset">("login");
  const [authRole, setAuthRole] = useState<"student" | "teacher">("student");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Admin states
  const [adminTab, setAdminTab] = useState("subjects");
  const [subjectDialog, setSubjectDialog] = useState(false);
  const [editSubject, setEditSubject] = useState<Subject | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [subjectDesc, setSubjectDesc] = useState("");
  const [quizDialog, setQuizDialog] = useState(false);
  const [editQuiz, setEditQuiz] = useState<Quiz | null>(null);
  const [quizTitle, setQuizTitle] = useState("");
  const [quizDesc, setQuizDesc] = useState("");
  const [quizDuration, setQuizDuration] = useState("40");
  const [quizStartDate, setQuizStartDate] = useState("");
  const [quizEndDate, setQuizEndDate] = useState("");
  const [quizSubjectId, setQuizSubjectId] = useState("");

  // Student Preview State for Teacher
  const [previewDialog, setPreviewDialog] = useState(false);
  const [previewData, setPreviewData] = useState<{ title: string; durationMinutes: number; questions: QuizQuestion[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importDialog, setImportDialog] = useState(false);
  const [importQuizId, setImportQuizId] = useState("");
  const [importPreview, setImportPreview] = useState<ImportQuestion[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const confirmFileRef = useRef<HTMLInputElement>(null);

  // Manual Question Dialog state
  const [questionDialog, setQuestionDialog] = useState(false);
  const [qQuizId, setQQuizId] = useState("");
  const [qText, setQText] = useState("");
  const [qPassage, setQPassage] = useState("");
  const [qType, setQType] = useState<"mcq" | "true_false">("mcq");
  const [qImageUrl, setQImageUrl] = useState<string | null>(null);
  const [qUploading, setQUploading] = useState(false);
  const [qChoices, setQChoices] = useState<{ text: string; isCorrect: boolean }[]>([
    { text: "", isCorrect: true },
    { text: "", isCorrect: false },
    { text: "", isCorrect: false },
    { text: "", isCorrect: false },
  ]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setQUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await api("/api/upload", { method: "POST", body: formData });
      if (data.url) {
        setQImageUrl(data.url);
        toast.success("Image uploaded & compressed");
      } else {
        toast.error("Image upload failed");
      }
    } catch {
      toast.error("Image upload failed");
    } finally {
      setQUploading(false);
    }
  };

  // Timer
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const submitQuizRef = useRef<(auto: boolean) => Promise<void>>();

  // Load user on mount
  useEffect(() => {
    const token = localStorage.getItem("quiz_token");
    if (token) {
      api("/api/auth/me").then((data) => {
        if (data.user) {
          setUser(data.user);
          // Admin goes directly to Teacher Panel
          if (data.user.role === "admin") {
            setView("admin");
          }
        } else {
          localStorage.removeItem("quiz_token");
        }
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // Load subjects
  const loadSubjects = useCallback(async () => {
    const data = await api("/api/subjects");
    if (data.subjects) setSubjects(data.subjects);
  }, []);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);

  // Load dashboard attempts (student)
  const loadStudentDashboard = useCallback(async () => {
    if (!user || user.role !== "student") return;
    const data = await api("/api/attempts?type=dashboard");
    if (data.attempts) setAttempts(data.attempts);
  }, [user]);

  // Load admin results (all students)
  const loadAdminResults = useCallback(async () => {
    if (!user || user.role !== "admin") return;
    const data = await api("/api/attempts?type=admin-results");
    if (data.attempts) setAttempts(data.attempts);
  }, [user]);

  // Load quizzes for a subject
  const loadSubjectQuizzes = useCallback(async (subjectId: string) => {
    const data = await api(`/api/quizzes?subjectId=${subjectId}`);
    if (data.quizzes) {
      setQuizzes(data.quizzes);
      const sub = subjects.find(s => s.id === subjectId);
      if (sub) setCurrentSubject({ ...sub, quizzes: data.quizzes });
    }
  }, [subjects]);

  // Timer for quiz
  useEffect(() => {
    if (!quizStarted || quizSubmitted) return;
    timerRef.current = setInterval(() => {
      const now = Date.now() + serverTimeOffset;
      const durationMs = (quizData?.quiz.durationMinutes || 40) * 60 * 1000;
      const elapsed = now - quizStartTime;
      const remaining = Math.max(0, durationMs - elapsed);
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        submitQuizRef.current?.(true);
      }
    }, 250);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [quizStarted, quizSubmitted, quizStartTime, serverTimeOffset, quizData]);

  // Format time
  const fmtTime = (ms: number) => {
    const sec = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const formatForDatetimeInput = (dateStr?: string | Date | null) => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return "";
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return "";
    }
  };

  // Auth handlers
  const handleAuth = async () => {
    setAuthLoading(true);
    const endpoint = authMode === "login" ? "/api/auth/sign-in" : "/api/auth/sign-up";
    const body = authMode === "login"
      ? { email: authEmail, password: authPassword }
      : { email: authEmail, password: authPassword, name: authName };
    const data = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
    if (data.user) {
      localStorage.setItem("quiz_token", data.token);
      setUser(data.user);
      setAuthEmail(""); setAuthPassword(""); setAuthName("");
      if (data.user.role === "admin") {
        setView("admin");
        toast.success("Logged in as Teacher");
      } else {
        setView("home");
        toast.success("Logged in successfully");
      }
    } else {
      toast.error(data.error || "Something went wrong");
    }
    setAuthLoading(false);
  };

  const handleResetPassword = async () => {
    if (!authEmail.trim() || !authPassword.trim()) {
      toast.error("Please enter your email and new password");
      return;
    }
    setAuthLoading(true);
    try {
      const data = await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: authEmail, newPassword: authPassword }),
      });
      if (data.success) {
        toast.success("Password reset successfully! You can now log in.");
        setAuthMode("login");
        setAuthPassword("");
      } else {
        toast.error(data.error || "Failed to reset password");
      }
    } catch {
      toast.error("Failed to reset password");
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("quiz_token");
    setUser(null);
    setView("home");
    setMobileMenuOpen(false);
    toast.success("Logged out");
  };

  // Show review (declared first for hoisting)
  const showReview = async (aid: string) => {
    setView("quiz");
    const data = await api(`/api/attempts?type=review&attemptId=${aid}`);
    if (data.questions) {
      setReviewData(data);
      setQuizSubmitted(true);
      setQuizStarted(false);
    }
  };

  // Submit quiz
  const submitQuiz = async (auto = false) => {
    submitQuizRef.current = submitQuiz;
    if (quizSubmitted || !attemptId) return;
    if (timerRef.current) clearInterval(timerRef.current);
    const unanswered = quizAnswers.filter(a => a === null || a === undefined).length;
    if (!auto && unanswered > 0) {
      if (!confirm(`You still have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Submit as-is?`)) return;
    }
    try {
      await api("/api/attempts", {
        method: "POST",
        body: JSON.stringify({ action: "submit", attemptId, answers: quizAnswers, auto }),
      });
      loadSubjects();
    } catch { /* silent */ }
    setQuizSubmitted(true);
    showReview(attemptId);
  };

  // Save progress
  const saveProgress = async () => {
    if (!attemptId || quizSubmitted) return;
    try {
      const data = await api("/api/attempts", {
        method: "POST",
        body: JSON.stringify({ action: "save", attemptId, answers: quizAnswers }),
      });
      if (data.status === "saved") toast.success("Saved");
      if (data.status === "expired" || data.status === "already_submitted") { void submitQuiz(true); }
    } catch { /* silent */ }
  };

  // Quiz start
  const startQuiz = async (quizId: string) => {
    if (!user) { setView("auth"); return; }
    const data = await api("/api/attempts", {
      method: "POST",
      body: JSON.stringify({ action: "start", quizId }),
    });
    if (data.status === "already_submitted") {
      showReview(data.attemptId);
      return;
    }
    if (data.error) { toast.error(data.error); return; }
    setQuizData({ quiz: { id: quizId, title: data.durationMin ? "" : "", description: null, durationMinutes: data.durationMin || 40 }, questions: data.questions });
    setQuizAnswers(data.answers || []);
    setAttemptId(data.attemptId);
    setQuizStartTime(data.startedAt);
    setServerTimeOffset(data.serverNow - Date.now());
    setQuizStarted(true);
    setQuizSubmitted(false);
    setReviewData(null);
    setView("quiz");
  };

  // Admin: Save subject
  const saveSubject = async () => {
    if (!subjectName.trim()) { toast.error("Subject name is required"); return; }
    if (editSubject) {
      await api("/api/subjects", { method: "PUT", body: JSON.stringify({ id: editSubject.id, name: subjectName, description: subjectDesc }) });
      toast.success("Subject updated");
    } else {
      await api("/api/subjects", { method: "POST", body: JSON.stringify({ name: subjectName, description: subjectDesc }) });
      toast.success("Subject added");
    }
    setSubjectDialog(false);
    setEditSubject(null);
    setSubjectName(""); setSubjectDesc("");
    loadSubjects();
  };

  // Admin: Delete subject
  const deleteSubject = async (id: string) => {
    if (!confirm("Are you sure you want to delete this subject and all its quizzes, questions, and attempts?")) return;
    const data = await api(`/api/subjects?id=${id}`, { method: "DELETE" });
    if (data.error) { toast.error(data.error); return; }
    toast.success("Subject deleted");
    loadSubjects();
  };

  // Admin: Save quiz
  const saveQuiz = async () => {
    if (!quizTitle.trim() || !quizSubjectId) { toast.error("Please fill in all required fields"); return; }
    const payload = {
      title: quizTitle,
      description: quizDesc,
      durationMinutes: parseInt(quizDuration) || 40,
      startDate: quizStartDate || null,
      endDate: quizEndDate || null,
      subjectId: quizSubjectId
    };
    if (editQuiz) {
      await api("/api/quizzes", { method: "PUT", body: JSON.stringify({ id: editQuiz.id, ...payload }) });
      toast.success("Quiz updated");
    } else {
      await api("/api/quizzes", { method: "POST", body: JSON.stringify(payload) });
      toast.success("Quiz added");
    }
    setQuizDialog(false);
    setEditQuiz(null);
    setQuizTitle(""); setQuizDesc(""); setQuizDuration("40"); setQuizStartDate(""); setQuizEndDate("");
    loadSubjects();
  };

  // Teacher Student Preview Modal Handler
  const openStudentPreview = async (quizId: string) => {
    setPreviewLoading(true);
    setPreviewDialog(true);
    setPreviewData(null);
    try {
      const data = await api(`/api/attempts?type=preview&quizId=${quizId}`);
      if (data.questions) {
        setPreviewData(data);
      } else {
        toast.error(data.error || "Failed to load preview");
        setPreviewDialog(false);
      }
    } catch {
      toast.error("Failed to load preview");
      setPreviewDialog(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Admin: Delete quiz (FIXED: check for errors)
  const deleteQuiz = async (id: string) => {
    if (!confirm("Delete this quiz and all its questions, attempts, and results?")) return;
    const data = await api(`/api/quizzes?id=${id}`, { method: "DELETE" });
    if (data.error) { toast.error(data.error); return; }
    toast.success("Quiz deleted");
    loadSubjects();
  };

  // Admin: Save question
  const saveQuestion = async () => {
    if (!qQuizId || !qText.trim()) { toast.error("Please fill in the question text and select a quiz"); return; }
    const activeChoices = qType === "true_false"
      ? [
          { text: qChoices[0]?.text || "صح", isCorrect: qChoices[0]?.isCorrect ?? true },
          { text: qChoices[1]?.text || "خطأ", isCorrect: !(qChoices[0]?.isCorrect ?? true) }
        ]
      : qChoices.filter(c => c.text.trim().length > 0);

    if (activeChoices.length < 2) { toast.error("At least 2 choices are required"); return; }
    if (!activeChoices.some(c => c.isCorrect)) { toast.error("Please mark at least one correct choice"); return; }

    const data = await api("/api/questions", {
      method: "POST",
      body: JSON.stringify({
        quizId: qQuizId,
        text: qText,
        passage: qPassage.trim() || null,
        type: qType,
        imageUrl: qImageUrl,
        choices: activeChoices
      })
    });

    if (data.error) { toast.error(data.error); return; }
    toast.success("Question added successfully");
    setQuestionDialog(false);
    setQText(""); setQPassage(""); setQImageUrl(null);
    loadSubjects();
  };

  // Admin: Import preview
  const handleImportPreview = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !importQuizId) return;
    setImportLoading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("quizId", importQuizId);
    fd.append("action", "preview");
    const data = await api("/api/import", { method: "POST", body: fd });
    if (data.questions) {
      setImportPreview(data.questions);
      toast.success(`Extracted ${data.count} questions`);
    } else {
      toast.error(data.error || "Import failed");
    }
    setImportLoading(false);
  };

  // Admin: Confirm import
  const confirmImport = async () => {
    if (!importQuizId || !importPreview.length) return;
    setImportLoading(true);
    const fd = new FormData();
    if (importFileRef.current?.files?.[0]) {
      fd.append("file", importFileRef.current.files[0]);
    }
    fd.append("quizId", importQuizId);
    fd.append("action", "confirm");
    fd.append("questions", JSON.stringify(importPreview));
    const data = await api("/api/import", { method: "POST", body: fd });
    if (data.status === "imported") {
      toast.success(`Successfully imported ${data.count} questions`);
      setImportDialog(false);
      setImportPreview([]);
      loadSubjects();
    } else {
      toast.error(data.error || "Import failed");
    }
    setImportLoading(false);
  };

  // Download import example
  const downloadExample = () => {
    const a = document.createElement("a");
    a.href = "/api/import?action=example";
    a.download = "import-example.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success("Downloading example template...");
  };

  // Navigation helpers
  const goHome = () => { setView("home"); setCurrentSubject(null); setMobileMenuOpen(false); loadSubjects(); };
  const goToSubject = (subject: Subject) => {
    setCurrentSubject(subject);
    loadSubjectQuizzes(subject.id);
    setView("subject");
    setMobileMenuOpen(false);
  };
  const goToStudentDashboard = () => {
    loadStudentDashboard();
    setView("dashboard");
    setMobileMenuOpen(false);
  };
  const goToAdminResults = () => {
    loadAdminResults();
    setView("dashboard");
    setMobileMenuOpen(false);
  };
  const goToAdmin = () => { setView("admin"); setMobileMenuOpen(false); };

  // Calculate total pending
  const totalPending = subjects.reduce((sum, s) => sum + s.pendingQuizzes, 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // ==================== RENDER ====================
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ===== Top Bar ===== */}
      <header className="sticky top-0 z-50 bg-card border-b border-border shadow-sm">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => { if (view !== "home" && !(view === "admin" && user?.role === "admin")) { goHome(); } else { setMobileMenuOpen(!mobileMenuOpen); } }} className="p-2 rounded-lg hover:bg-secondary transition-colors">
              {view !== "home" && !(view === "admin" && user?.role === "admin") ? <ChevronLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <button onClick={goHome} className="font-bold text-lg hover:opacity-80 transition-opacity">
              Dr. Rahma <span className="text-primary">·</span> Quiz Bank
            </button>
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                {user.role === "student" && (
                  <Button variant="ghost" size="sm" onClick={goToStudentDashboard} className="gap-1.5 text-sm">
                    <LayoutDashboard className="w-4 h-4" />
                    <span className="hidden sm:inline">My Results</span>
                  </Button>
                )}
                {user.role === "admin" && (
                  <>
                    <Button variant="ghost" size="sm" onClick={goToAdminResults} className="gap-1.5 text-sm">
                      <BarChart3 className="w-4 h-4" />
                      <span className="hidden sm:inline">Results</span>
                    </Button>
                    <Button size="sm" onClick={goToAdmin} className="gap-1.5 bg-primary">
                      <Shield className="w-4 h-4" />
                      <span className="hidden sm:inline">Teacher Panel</span>
                    </Button>
                  </>
                )}
                <div className="w-px h-6 bg-border mx-1" />
                <Button variant="ghost" size="sm" onClick={logout} className="gap-1.5 text-sm text-destructive">
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">Logout</span>
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => { setAuthRole("teacher"); setAuthMode("login"); setView("auth"); }} className="gap-1.5 text-primary">
                  <Shield className="w-4 h-4" />
                  <span className="hidden sm:inline">Teacher</span>
                </Button>
                <Button size="sm" onClick={() => { setAuthRole("student"); setAuthMode("login"); setView("auth"); }} className="gap-1.5">
                  <LogIn className="w-4 h-4" />
                  <span>Login</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ===== Mobile Menu ===== */}
      <AnimatePresence>
        {mobileMenuOpen && (view === "home" || (view === "admin" && user?.role === "admin")) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-14 left-0 right-0 z-40 bg-card border-b border-border shadow-lg p-4"
          >
            <div className="flex flex-col gap-2">
              {user?.role === "student" && (
                <Button variant="ghost" className="justify-start gap-2" onClick={goToStudentDashboard}>
                  <LayoutDashboard className="w-4 h-4" /> My Results
                </Button>
              )}
              {user?.role === "admin" && (
                <>
                  <Button variant="ghost" className="justify-start gap-2" onClick={goToAdminResults}>
                    <BarChart3 className="w-4 h-4" /> Results
                  </Button>
                  <Button variant="ghost" className="justify-start gap-2" onClick={goToAdmin}>
                    <Shield className="w-4 h-4" /> Teacher Panel
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Main Content ===== */}
      <main className="flex-1">
        <AnimatePresence mode="wait">

          {/* ========== HOME (Student only, or unauthenticated) ========== */}
          {view === "home" && !user && (
            <motion.div key="home" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-lg mx-auto px-4 py-16">
              <div className="text-center mb-10">
                <h1 className="text-3xl font-bold mb-2">Dr. Rahma · Quiz Bank</h1>
                <p className="text-muted-foreground">Choose how you want to continue</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button onClick={() => { setAuthRole("student"); setAuthMode("login"); setView("auth"); }}
                  className="bg-card border-2 border-border rounded-xl p-6 text-center hover:border-primary hover:shadow-lg transition-all group">
                  <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                    <Users className="w-7 h-7 text-blue-600" />
                  </div>
                  <h2 className="font-bold text-lg mb-1">Student</h2>
                  <p className="text-sm text-muted-foreground">Take quizzes and view your results</p>
                </button>
                <button onClick={() => { setAuthRole("teacher"); setAuthMode("login"); setView("auth"); }}
                  className="bg-card border-2 border-border rounded-xl p-6 text-center hover:border-primary hover:shadow-lg transition-all group">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                    <Shield className="w-7 h-7 text-primary" />
                  </div>
                  <h2 className="font-bold text-lg mb-1">Teacher</h2>
                  <p className="text-sm text-muted-foreground">Manage subjects, quizzes & questions</p>
                </button>
              </div>
            </motion.div>
          )}

          {/* ========== HOME (Student logged in - sees subjects) ========== */}
          {view === "home" && user && user.role === "student" && (
            <motion.div key="home-student" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-4xl mx-auto px-4 py-6">
              <div className="mb-6">
                <h1 className="text-2xl font-bold mb-1">Subjects</h1>
                <p className="text-muted-foreground text-sm">Pick a subject to see available quizzes</p>
              </div>

              {totalPending > 0 && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="mb-4 p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-primary" />
                  <span>You have <strong>{totalPending}</strong> unfinished quiz{totalPending === 1 ? "" : "zes"}</span>
                </motion.div>
              )}

              {subjects.length === 0 ? (
                <Card className="p-6 text-center">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">No subjects yet. The teacher can add them from the Teacher Panel.</p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {subjects.map((subject, i) => (
                    <motion.button key={subject.id}
                      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                      onClick={() => goToSubject(subject)}
                      className="bg-card border border-border rounded-xl p-5 text-left hover:border-primary hover:shadow-md transition-all group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <FolderOpen className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                        <h3 className="font-semibold text-base">{subject.name}</h3>
                      </div>
                      {subject.description && (
                        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{subject.description}</p>
                      )}
                      <div className="flex gap-4 text-sm">
                        <div className="font-mono text-primary font-semibold">{subject.quizCount}<span className="block text-xs text-muted-foreground font-sans font-normal">quiz{subject.quizCount === 1 ? "" : "zes"}</span></div>
                        {subject.pendingQuizzes > 0 && (
                          <div className="font-mono text-destructive font-semibold">{subject.pendingQuizzes}<span className="block text-xs text-muted-foreground font-sans font-normal">remaining</span></div>
                        )}
                      </div>
                    </motion.button>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ========== SUBJECT (Student only) ========== */}
          {view === "subject" && currentSubject && user?.role === "student" && (
            <motion.div key="subject" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-4xl mx-auto px-4 py-6">
              <div className="mb-6">
                <h1 className="text-2xl font-bold mb-1">{currentSubject.name}</h1>
                {currentSubject.description && <p className="text-muted-foreground text-sm">{currentSubject.description}</p>}
              </div>

              {quizzes.length === 0 ? (
                <Card className="p-6 text-center">
                  <HelpCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">No quizzes available in this subject yet.</p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {quizzes.map((quiz, i) => {
                    const now = new Date();
                    const isNotStarted = quiz.startDate && now < new Date(quiz.startDate);
                    const isExpired = quiz.endDate && now > new Date(quiz.endDate);

                    return (
                      <motion.div key={quiz.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                        className="bg-card border border-border rounded-xl p-4 sm:p-5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <h3 className="font-semibold mb-1">{quiz.title}</h3>
                            {quiz.description && <p className="text-sm text-muted-foreground mb-2">{quiz.description}</p>}
                            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1"><HelpCircle className="w-3.5 h-3.5" /> {quiz.questionCount} questions</span>
                              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {quiz.durationMinutes} min</span>
                              {quiz.startDate && <span className="text-amber-700 font-medium">Starts: {new Date(quiz.startDate).toLocaleDateString()}</span>}
                              {quiz.endDate && <span className="text-destructive font-medium">Ends: {new Date(quiz.endDate).toLocaleDateString()}</span>}
                            </div>
                          </div>
                          {quiz.status === "submitted" ? (
                            <Badge variant="secondary" className="bg-green-100 text-green-700 shrink-0">Completed ✓</Badge>
                          ) : isNotStarted ? (
                            <div className="text-right shrink-0">
                              <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 block mb-1 text-[11px]">Starts: {new Date(quiz.startDate!).toLocaleString()}</Badge>
                              <Button disabled size="sm" className="opacity-50">Not Started Yet</Button>
                            </div>
                          ) : isExpired ? (
                            <div className="text-right shrink-0">
                              <Badge variant="destructive" className="block mb-1 text-[11px]">Expired: {new Date(quiz.endDate!).toLocaleString()}</Badge>
                              <Button disabled size="sm" className="opacity-50">Expired</Button>
                            </div>
                          ) : (
                            <Button onClick={() => startQuiz(quiz.id)} size="sm" className="shrink-0 gap-1.5">
                              <Play className="w-4 h-4" /> Start
                            </Button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {/* ========== QUIZ (running or review) ========== */}
          {view === "quiz" && (
            <motion.div key="quiz" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-4xl mx-auto px-4 py-6">
              {/* Quiz Header */}
              <div className="bg-card border border-border rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h1 className="font-bold text-lg">{quizData?.quiz.title || "Quiz"}</h1>
                  {quizStarted && !quizSubmitted && (
                    <div className={`font-mono text-xl px-3 py-1.5 rounded-lg border ${timeRemaining < 60000 ? "bg-red-50 border-red-400 text-red-600 timer-pulse" : "bg-secondary border-primary/30 text-primary"}`}>
                      {fmtTime(timeRemaining)}
                    </div>
                  )}
                </div>
                {quizData?.quiz.description && <p className="text-sm text-muted-foreground">{quizData.quiz.description}</p>}

                {/* Landing */}
                {!quizStarted && !quizSubmitted && quizData && (
                  <div className="mt-4">
                    <div className="flex gap-6 py-3 border-y border-border mb-4">
                      <div><span className="block font-mono text-xl text-primary">{quizData.questions.length}</span><span className="text-xs text-muted-foreground">questions</span></div>
                      <div><span className="block font-mono text-xl text-primary">{quizData.quiz.durationMinutes}:00</span><span className="text-xs text-muted-foreground">time allowed</span></div>
                      <div><span className="block font-mono text-xl text-primary">{quizData.questions.reduce((s, q) => s + q.points, 0)}</span><span className="text-xs text-muted-foreground">points</span></div>
                    </div>
                    <p className="text-sm text-muted-foreground bg-secondary rounded-lg p-3 border-l-4 border-primary">
                      Your answers are auto-saved every few seconds. When time runs out, the quiz is submitted automatically. Each quiz can only be taken once.
                    </p>
                    <Button onClick={() => startQuiz(quizData.quiz.id)} className="mt-4 gap-2 w-full sm:w-auto">
                      <Play className="w-4 h-4" /> Start Quiz ({quizData.quiz.durationMinutes} min)
                    </Button>
                  </div>
                )}
              </div>

              {/* Progress */}
              {quizStarted && !quizSubmitted && (
                <div className="mb-4">
                  <Progress value={quizAnswers.filter(a => a !== null).length / (quizData?.questions.length || 1) * 100} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>{quizAnswers.filter(a => a !== null).length} / {quizData?.questions.length} answered</span>
                    <span></span>
                  </div>
                </div>
              )}

              {/* Questions */}
              {quizStarted && !quizSubmitted && quizData && (
                <div className="space-y-4">
                  {quizData.questions.map((q, qi) => (
                    <motion.div key={q.id} id={`q-${qi}`} className={`bg-card border rounded-xl p-4 scroll-mt-40 transition-colors ${quizAnswers[qi] !== null ? "border-primary" : "border-border"}`}>
                      {/* Reading Passage */}
                      {q.passage && (
                        <div className="mb-4 p-3.5 rounded-xl bg-primary/5 border border-primary/20 text-sm leading-relaxed">
                          <div className="font-bold text-xs text-primary mb-1.5 flex items-center gap-1.5">
                            <BookOpen className="w-4 h-4" /> قطعة قراءة / Passage
                          </div>
                          <p className="whitespace-pre-wrap text-foreground font-medium">{q.passage}</p>
                        </div>
                      )}

                      {/* Full-width responsive image */}
                      {q.imageUrl && (
                        <div className="my-3 w-full rounded-xl overflow-hidden border border-border bg-black/5 flex justify-center items-center p-2">
                          <img src={q.imageUrl} alt="Question image" className="w-full max-h-[450px] object-contain rounded-lg shadow-sm" />
                        </div>
                      )}

                      <div className="flex items-start gap-2 mb-3">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-secondary text-primary text-xs font-bold shrink-0 mt-0.5">{qi + 1}</span>
                        <p className="font-medium text-sm leading-relaxed">{q.text}{q.points > 1 ? ` (${q.points} pts)` : ""}</p>
                      </div>

                      {/* True / False vs MCQ Choices */}
                      {q.type === "true_false" ? (
                        <div className="grid grid-cols-2 gap-3 sm:max-w-md mt-2">
                          {q.choices.map((choice, ci) => (
                            <button
                              key={ci}
                              type="button"
                              onClick={() => {
                                const newAnswers = [...quizAnswers];
                                newAnswers[qi] = ci;
                                setQuizAnswers(newAnswers);
                              }}
                              className={`p-3.5 rounded-xl border-2 font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                                quizAnswers[qi] === ci
                                  ? (ci === 0 ? "border-green-600 bg-green-600 text-white shadow-md" : "border-red-600 bg-red-600 text-white shadow-md")
                                  : "border-border bg-card hover:bg-secondary text-foreground"
                              }`}
                            >
                              {choice}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-1.5 ml-8">
                          {q.choices.map((choice, ci) => (
                            <label key={ci} className={`quiz-choice flex items-center gap-3 p-2.5 rounded-lg border ${quizAnswers[qi] === ci ? "selected border-primary bg-secondary" : "border-transparent"}`} onClick={() => {
                              const newAnswers = [...quizAnswers];
                              newAnswers[qi] = ci;
                              setQuizAnswers(newAnswers);
                            }}>
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${quizAnswers[qi] === ci ? "border-primary" : "border-muted-foreground/30"}`}>
                                {quizAnswers[qi] === ci && <div className="w-2 h-2 rounded-full bg-primary" />}
                              </div>
                              <span className="text-sm">{choice}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Submit Bar */}
              {quizStarted && !quizSubmitted && (
                <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm pt-4 pb-2 mt-4">
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={saveProgress} className="gap-1.5"><Save className="w-4 h-4" /> Save</Button>
                    <Button onClick={() => submitQuiz(false)} className="flex-1 gap-1.5"><Send className="w-4 h-4" /> Submit Quiz</Button>
                  </div>
                </div>
              )}

              {/* Review Results */}
              {quizSubmitted && reviewData && (
                <div>
                  <div className="bg-card border border-border rounded-xl p-6 text-center mb-6">
                    <Award className="w-12 h-12 mx-auto mb-3 text-primary" />
                    <div className="font-mono text-4xl font-bold text-primary">{reviewData.score} / {reviewData.totalPoints}</div>
                    <p className="text-muted-foreground mt-1">{reviewData.percent}% correct</p>
                  </div>
                  <div className="space-y-4">
                    {reviewData.questions.map((q, qi) => {
                      const isCorrect = q.picked === q.correct;
                      return (
                        <div key={q.id} className={`bg-card border rounded-xl p-4 ${isCorrect ? "border-green-500 bg-green-50/50" : "border-red-400 bg-red-50/50"}`}>
                          <div className={`text-xs font-bold uppercase tracking-wide mb-2 ${isCorrect ? "text-green-600" : "text-red-600"}`}>
                            {isCorrect ? "✓ Correct" : (q.picked === null ? "No answer" : "✗ Incorrect")}
                          </div>

                          {/* Reading Passage in Review */}
                          {q.passage && (
                            <div className="mb-3 p-3 rounded-lg bg-white/80 border text-xs leading-relaxed">
                              <span className="font-bold text-primary block mb-1">Passage / قطعة:</span>
                              <p className="whitespace-pre-wrap">{q.passage}</p>
                            </div>
                          )}

                          {/* Full-width Image in Review */}
                          {q.imageUrl && (
                            <div className="my-3 w-full rounded-xl overflow-hidden border bg-white flex justify-center items-center p-2">
                              <img src={q.imageUrl} alt="Question image" className="w-full max-h-[450px] object-contain rounded-lg" />
                            </div>
                          )}

                          <div className="flex items-start gap-2 mb-3">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-white text-primary text-xs font-bold shrink-0">{qi + 1}</span>
                            <p className="font-medium text-sm">{q.text}</p>
                          </div>
                          <div className="space-y-1.5 ml-8">
                            {q.choices.map((c, ci) => (
                              <div key={c.id} className={`p-2.5 rounded-lg text-sm ${ci === q.correct ? "font-bold text-green-700 bg-green-100" : ci === q.picked && !isCorrect ? "line-through text-red-600 bg-red-100" : "text-muted-foreground"}`}>
                                {c.text}{ci === q.correct ? " ✓" : ""}{ci === q.picked && !isCorrect ? " ✗" : ""}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-center mt-6">
                    <Button onClick={goHome} className="gap-2">Back to Home</Button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ========== STUDENT DASHBOARD ========== */}
          {view === "dashboard" && user?.role === "student" && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-4xl mx-auto px-4 py-6">
              <div className="mb-6">
                <h1 className="text-2xl font-bold mb-1">My Results</h1>
                <p className="text-muted-foreground text-sm">Hello, {user.name || user.email}</p>
              </div>

              {totalPending > 0 && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="mb-4 p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-primary" />
                  <span>You have <strong>{totalPending}</strong> unfinished quiz{totalPending === 1 ? "" : "zes"}</span>
                  <Button variant="ghost" size="sm" onClick={goHome} className="ml-auto text-primary">View Subjects</Button>
                </motion.div>
              )}

              {attempts.length === 0 ? (
                <Card className="p-6 text-center">
                  <BarChart3 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">No results yet. Start a quiz to see your scores!</p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {attempts.map((attempt, i) => (
                    <motion.div key={attempt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                      className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm truncate">{attempt.quiz.title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{attempt.quiz.subjectName} • {new Date(attempt.submittedAt).toLocaleDateString()}</p>
                      </div>
                      <div className="text-center shrink-0">
                        <div className={`font-mono text-xl font-bold ${attempt.percent >= 60 ? "text-green-600" : "text-destructive"}`}>{attempt.percent}%</div>
                        <div className="text-xs text-muted-foreground">{attempt.score}/{attempt.totalPoints}</div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => showReview(attempt.id)} className="shrink-0 gap-1">
                        <Eye className="w-4 h-4" /> Review
                      </Button>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ========== ADMIN RESULTS (All Students) ========== */}
          {view === "dashboard" && user?.role === "admin" && (
            <motion.div key="admin-results" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-4xl mx-auto px-4 py-6">
              <div className="mb-6">
                <h1 className="text-2xl font-bold mb-1">All Student Results</h1>
                <p className="text-muted-foreground text-sm">View all submitted quiz attempts from students</p>
              </div>

              {attempts.length === 0 ? (
                <Card className="p-6 text-center">
                  <BarChart3 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">No submitted quizzes yet. Students haven't taken any quizzes.</p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {attempts.map((attempt, i) => (
                    <motion.div key={attempt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                      className="bg-card border border-border rounded-xl p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-sm truncate">{attempt.quiz.title}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {attempt.quiz.subjectName} • {new Date(attempt.submittedAt).toLocaleDateString()}
                            {attempt.userName && <span className="ml-2 font-medium text-foreground">• {attempt.userName}</span>}
                          </p>
                        </div>
                        <div className="text-center shrink-0">
                          <div className={`font-mono text-xl font-bold ${attempt.percent >= 60 ? "text-green-600" : "text-destructive"}`}>{attempt.percent}%</div>
                          <div className="text-xs text-muted-foreground">{attempt.score}/{attempt.totalPoints}</div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => showReview(attempt.id)} className="shrink-0 gap-1">
                          <Eye className="w-4 h-4" /> Review
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ========== AUTH ========== */}
          {view === "auth" && !user && (
            <motion.div key="auth" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="max-w-sm mx-auto px-4 py-16">
              <Card className="p-6">
                <div className="text-center mb-6">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${authRole === "teacher" ? "bg-primary/10" : "bg-blue-50"}`}>
                    {authRole === "teacher" ? <Shield className="w-6 h-6 text-primary" /> : <LogIn className="w-6 h-6 text-blue-600" />}
                  </div>
                  <h2 className="text-xl font-bold">
                    {authRole === "teacher" ? "Teacher Sign In" : authMode === "reset" ? "Reset Password" : authMode === "login" ? "Student Sign In" : "Student Sign Up"}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    {authRole === "teacher"
                      ? "Access the teacher management panel"
                      : authMode === "reset"
                      ? "Enter your email and new password"
                      : authMode === "login"
                      ? "Login to take quizzes"
                      : "Create a new student account"}
                  </p>
                </div>

                {/* Role switcher */}
                {authMode === "login" && (
                  <div className="flex rounded-lg border border-border p-0.5 mb-5">
                    <button onClick={() => setAuthRole("student")} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${authRole === "student" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                      Student
                    </button>
                    <button onClick={() => setAuthRole("teacher")} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${authRole === "teacher" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                      Teacher
                    </button>
                  </div>
                )}

                <div className="space-y-4">
                  {authRole === "student" && authMode === "register" && (
                    <div>
                      <Label>Full Name</Label>
                      <Input placeholder="John Doe" value={authName} onChange={e => setAuthName(e.target.value)} className="mt-1" />
                    </div>
                  )}
                  <div>
                    <Label>Email</Label>
                    <Input type="email" placeholder="you@example.com" value={authEmail} onChange={e => setAuthEmail(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <div className="flex justify-between items-center">
                      <Label>{authMode === "reset" ? "New Password" : "Password"}</Label>
                      {authMode === "login" && (
                        <button type="button" onClick={() => setAuthMode("reset")} className="text-xs text-primary font-medium hover:underline">
                          Forgot? / نسيت السر؟
                        </button>
                      )}
                    </div>
                    <Input type="password" placeholder="•••••••" value={authPassword} onChange={e => setAuthPassword(e.target.value)} className="mt-1" />
                  </div>

                  {authMode === "reset" ? (
                    <Button onClick={handleResetPassword} disabled={authLoading || !authEmail || !authPassword} className="w-full gap-2">
                      {authLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
                      Reset Password / تغيير كلمة المرور
                    </Button>
                  ) : (
                    <Button onClick={handleAuth} disabled={authLoading || !authEmail || !authPassword} className="w-full gap-2">
                      {authLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
                      {authRole === "teacher" ? "Sign In as Teacher" : authMode === "login" ? "Sign In" : "Create Account"}
                    </Button>
                  )}
                </div>

                <div className="mt-4 text-center text-sm space-y-1">
                  {authMode === "reset" ? (
                    <button onClick={() => setAuthMode("login")} className="text-primary font-semibold hover:underline text-xs">
                      Back to Sign In / العودة لتسجيل الدخول
                    </button>
                  ) : authRole === "student" ? (
                    <button onClick={() => setAuthMode(authMode === "login" ? "register" : "login")} className="text-primary font-semibold hover:underline">
                      {authMode === "login" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                    </button>
                  ) : null}
                </div>
              </Card>
            </motion.div>
          )}

          {/* ========== ADMIN (Teacher Panel) ========== */}
          {view === "admin" && user?.role === "admin" && (
            <motion.div key="admin" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-4xl mx-auto px-4 py-6">
              <div className="mb-6">
                <h1 className="text-2xl font-bold mb-1">Teacher Panel</h1>
                <p className="text-muted-foreground text-sm">Hello, {user.name || user.email} — manage subjects, quizzes & questions</p>
              </div>

              <Tabs value={adminTab} onValueChange={setAdminTab}>
                <TabsList className="w-full mb-6">
                  <TabsTrigger value="subjects" className="flex-1 gap-1.5"><FolderOpen className="w-4 h-4" /> Subjects</TabsTrigger>
                  <TabsTrigger value="quizzes" className="flex-1 gap-1.5"><FileText className="w-4 h-4" /> Quizzes</TabsTrigger>
                  <TabsTrigger value="import" className="flex-1 gap-1.5"><Upload className="w-4 h-4" /> Import</TabsTrigger>
                </TabsList>

                {/* Subjects Tab */}
                <TabsContent value="subjects">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold">Subjects ({subjects.length})</h2>
                    <Button size="sm" onClick={() => { setEditSubject(null); setSubjectName(""); setSubjectDesc(""); setSubjectDialog(true); }} className="gap-1.5">
                      <Plus className="w-4 h-4" /> Add Subject
                    </Button>
                  </div>
                  {subjects.length === 0 ? (
                    <Card className="p-6 text-center text-muted-foreground">No subjects yet</Card>
                  ) : (
                    <div className="space-y-2">
                      {subjects.map((s) => (
                        <div key={s.id} className="bg-card border border-border rounded-lg p-3 flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-sm">{s.name}</h3>
                            <p className="text-xs text-muted-foreground">{s.description || "No description"} • {s.quizCount} quiz{ s.quizCount === 1 ? "" : "zes"}</p>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => { setEditSubject(s); setSubjectName(s.name); setSubjectDesc(s.description || ""); setSubjectDialog(true); }}><Edit3 className="w-4 h-4" /></Button>
                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteSubject(s.id)}><Trash2 className="w-4 h-4" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Quizzes Tab */}
                <TabsContent value="quizzes">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold">Quizzes</h2>
                    <Button size="sm" onClick={() => { setEditQuiz(null); setQuizTitle(""); setQuizDesc(""); setQuizDuration("40"); setQuizSubjectId(subjects[0]?.id || ""); setQuizDialog(true); }} className="gap-1.5">
                      <Plus className="w-4 h-4" /> Add Quiz
                    </Button>
                  </div>
                  {subjects.length === 0 ? (
                    <Card className="p-6 text-center text-muted-foreground">Add subjects first, then create quizzes</Card>
                  ) : (
                    <div className="space-y-2">
                      {subjects.map((s) => (
                        s.quizzes.length > 0 && (
                          <div key={s.id} className="mb-4">
                            <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5"><FolderOpen className="w-4 h-4" /> {s.name}</h3>
                            {s.quizzes.map((q) => (
                              <div key={q.id} className="bg-card border border-border rounded-lg p-3 mb-2 flex items-center justify-between">
                                <div>
                                  <h4 className="font-semibold text-sm">{q.title}</h4>
                                  <p className="text-xs text-muted-foreground">
                                    {q.questionCount} questions • {q.durationMinutes} min • {q.attemptCount} attempt{q.attemptCount === 1 ? "" : "s"}
                                    {q.startDate && <span className="ml-2 text-amber-700 font-medium">Starts: {new Date(q.startDate).toLocaleDateString()}</span>}
                                    {q.endDate && <span className="ml-2 text-destructive font-medium">Ends: {new Date(q.endDate).toLocaleDateString()}</span>}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Button size="sm" variant="ghost" onClick={() => openStudentPreview(q.id)} title="Student Preview / معاينة الطالب" className="gap-1 text-xs text-primary">
                                    <Eye className="w-3.5 h-3.5" /> Preview
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => { setQQuizId(q.id); setQText(""); setQPassage(""); setQType("mcq"); setQImageUrl(null); setQChoices([{ text: "", isCorrect: true }, { text: "", isCorrect: false }, { text: "", isCorrect: false }, { text: "", isCorrect: false }]); setQuestionDialog(true); }} className="gap-1 text-xs">
                                    <Plus className="w-3.5 h-3.5" /> Question
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => {
                                    setEditQuiz(q);
                                    setQuizTitle(q.title);
                                    setQuizDesc(q.description || "");
                                    setQuizDuration(String(q.durationMinutes));
                                    setQuizStartDate(formatForDatetimeInput(q.startDate));
                                    setQuizEndDate(formatForDatetimeInput(q.endDate));
                                    setQuizSubjectId(s.id);
                                    setQuizDialog(true);
                                  }}><Edit3 className="w-4 h-4" /></Button>
                                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteQuiz(q.id)}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Import Tab */}
                <TabsContent value="import">
                  <div className="mb-4">
                    <h2 className="font-semibold mb-1">Import Questions</h2>
                    <p className="text-sm text-muted-foreground">Upload a Word (.docx) or Excel (.xlsx) file to auto-import questions</p>
                  </div>

                  {/* Download Example Button */}
                  <Card className="p-4 mb-4 bg-primary/5 border-primary/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Download className="w-5 h-5 text-primary" />
                        <div>
                          <p className="text-sm font-semibold">Need an example template?</p>
                          <p className="text-xs text-muted-foreground">Download a sample Excel file showing the expected format</p>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={downloadExample} className="gap-1.5 shrink-0">
                        <Download className="w-4 h-4" /> Download Example
                      </Button>
                    </div>
                    <div className="mt-3 p-3 bg-background rounded-lg text-xs text-muted-foreground space-y-2 border">
                      <p className="font-semibold text-foreground text-sm flex items-center gap-1.5 text-primary">
                        📝 دليل رفع الكويزات والأسئلة (Word & Excel):
                      </p>

                      <div className="p-2.5 bg-primary/5 border border-primary/20 rounded-md space-y-1">
                        <p className="font-bold text-foreground text-xs text-primary flex items-center gap-1">
                          📄 1. ملف وورد Word (.docx) — الخيار الأسهل للصور المباشرة:
                        </p>
                        <p className="text-muted-foreground">
                          • انسخ وألصق الصور من جهازك مباشرة داخل ملف الوورد تحت السؤال أو قبله!
                        </p>
                        <p className="text-muted-foreground">
                          • لإضافة قطعة قراءة: ابدأ الفقرة بـ <code className="bg-primary/10 text-primary px-1 rounded font-bold">[قطعة: ...]</code> أو <code className="bg-primary/10 text-primary px-1 rounded font-bold">[Passage: ...]</code>.
                        </p>
                        <p className="text-muted-foreground">
                          • اكتب السؤال متبوعاً بالخيارات <code className="font-bold text-foreground">A) ... B) ... C) ... D) ...</code> أو أسئلة الصح والخطأ <code className="font-bold text-foreground">(T/F)</code>.
                        </p>
                      </div>

                      <div className="p-2.5 bg-secondary/50 border rounded-md space-y-1">
                        <p className="font-bold text-foreground text-xs flex items-center gap-1">
                          📊 2. ملف إكسيل Excel (.xlsx):
                        </p>
                        <p className="text-muted-foreground">
                          • أسماء الأعمدة: <code className="bg-secondary px-1 rounded text-primary font-mono">question</code>, <code className="bg-secondary px-1 rounded text-primary font-mono">choice1</code> .. <code className="bg-secondary px-1 rounded text-primary font-mono">choice4</code>, <code className="bg-secondary px-1 rounded text-primary font-mono">correct</code>, <code className="bg-secondary px-1 rounded text-primary font-mono">passage</code>, <code className="bg-secondary px-1 rounded text-primary font-mono">image</code>.
                        </p>
                        <p className="text-muted-foreground">
                          • للصور: اكتب رابط الصورة أو اسمها أو كودها في عمود <code className="font-mono text-primary">image</code> أمام كل سؤال يحتوي على صورة.
                        </p>
                      </div>
                    </div>
                  </Card>

                  <Card className="p-5">
                    <div className="space-y-4">
                      <div>
                        <Label>Select Quiz</Label>
                        <select value={importQuizId} onChange={e => setImportQuizId(e.target.value)} className="w-full mt-1 p-2.5 border border-border rounded-lg text-sm bg-background">
                          <option value="">-- Select a quiz --</option>
                          {subjects.flatMap(s => s.quizzes.map(q => ({ ...q, subjectName: s.name }))).map(q => (
                            <option key={q.id} value={q.id}>{q.subjectName} — {q.title}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label>Upload File</Label>
                        <div className="mt-1 border-2 border-dashed border-border rounded-lg p-6 text-center">
                          <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground mb-2">Drag & drop or click to choose</p>
                          <input ref={importFileRef} type="file" accept=".docx,.xlsx,.xls" onChange={handleImportPreview} className="text-sm" />
                        </div>
                      </div>

                      {importLoading && <div className="text-center text-sm text-muted-foreground">Processing...</div>}

                      {importPreview.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="font-semibold text-sm">Preview ({importPreview.length} questions)</h3>
                          </div>
                          <div className="max-h-96 overflow-y-auto custom-scroll space-y-2 border border-border rounded-lg p-3">
                            {importPreview.map((q, i) => (
                              <div key={i} className="bg-secondary/50 rounded-lg p-3">
                                <div className="flex items-start gap-2 mb-2">
                                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold shrink-0">{i + 1}</span>
                                  <p className="text-sm font-medium">{q.text}</p>
                                </div>
                                {q.imageUrl && <img src={q.imageUrl} alt="" className="max-h-32 rounded-lg mb-2" />}
                                <div className="ml-7 space-y-1">
                                  {q.choices.map((c, ci) => (
                                    <div key={ci} className={`text-xs p-1.5 rounded ${c.isCorrect ? "bg-green-100 text-green-700 font-bold" : "text-muted-foreground"}`}>
                                      {String.fromCharCode(65 + ci)}) {c.text} {c.isCorrect ? "✓" : ""}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-2 mt-4">
                            <Button onClick={confirmImport} disabled={importLoading} className="flex-1 gap-1.5">
                              {importLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                              Confirm Import
                            </Button>
                            <Button variant="outline" onClick={() => setImportPreview([])}>Cancel</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                </TabsContent>
              </Tabs>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ===== Subject Dialog ===== */}
      <Dialog open={subjectDialog} onOpenChange={setSubjectDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editSubject ? "Edit Subject" : "Add New Subject"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Subject Name</Label><Input value={subjectName} onChange={e => setSubjectName(e.target.value)} placeholder="e.g. Anatomy" className="mt-1" /></div>
            <div><Label>Description (optional)</Label><Input value={subjectDesc} onChange={e => setSubjectDesc(e.target.value)} placeholder="Brief description" className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubjectDialog(false)}>Cancel</Button>
            <Button onClick={saveSubject} disabled={!subjectName.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Quiz Dialog ===== */}
      <Dialog open={quizDialog} onOpenChange={setQuizDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editQuiz ? "Edit Quiz" : "Add New Quiz"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Subject</Label>
              <select value={quizSubjectId} onChange={e => setQuizSubjectId(e.target.value)} className="w-full mt-1 p-2.5 border border-border rounded-lg text-sm bg-background">
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div><Label>Quiz Title</Label><Input value={quizTitle} onChange={e => setQuizTitle(e.target.value)} placeholder="e.g. Unit 1 Quiz" className="mt-1" /></div>
            <div><Label>Description (optional)</Label><Input value={quizDesc} onChange={e => setQuizDesc(e.target.value)} placeholder="Brief description" className="mt-1" /></div>
            <div><Label>Duration (minutes)</Label><Input type="number" value={quizDuration} onChange={e => setQuizDuration(e.target.value)} className="mt-1" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border">
              <div>
                <Label className="text-xs">Start Date & Time (optional)</Label>
                <Input type="datetime-local" value={quizStartDate} onChange={e => setQuizStartDate(e.target.value)} className="mt-1 text-xs" />
              </div>
              <div>
                <Label className="text-xs">End Date & Time (optional)</Label>
                <Input type="datetime-local" value={quizEndDate} onChange={e => setQuizEndDate(e.target.value)} className="mt-1 text-xs" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuizDialog(false)}>Cancel</Button>
            <Button onClick={saveQuiz} disabled={!quizTitle.trim() || !quizSubjectId}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Question Dialog ===== */}
      <Dialog open={questionDialog} onOpenChange={setQuestionDialog}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto custom-scroll">
          <DialogHeader>
            <DialogTitle>Add New Question</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Question Type / نوع السؤال</Label>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setQType("mcq");
                    if (qChoices.length < 4) {
                      setQChoices([
                        { text: "", isCorrect: true },
                        { text: "", isCorrect: false },
                        { text: "", isCorrect: false },
                        { text: "", isCorrect: false },
                      ]);
                    }
                  }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${qType === "mcq" ? "bg-primary text-white border-primary shadow-sm" : "border-border hover:bg-secondary"}`}
                >
                  MCQ (اختيار من متعدد)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQType("true_false");
                    setQChoices([
                      { text: "صح", isCorrect: true },
                      { text: "خطأ", isCorrect: false }
                    ]);
                  }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${qType === "true_false" ? "bg-primary text-white border-primary shadow-sm" : "border-border hover:bg-secondary"}`}
                >
                  True / False (صح أم خطأ)
                </button>
              </div>
            </div>

            <div>
              <Label>Reading Passage / قطعة قراءة (optional)</Label>
              <textarea
                rows={3}
                value={qPassage}
                onChange={e => setQPassage(e.target.value)}
                placeholder="Enter context, medical case study, or passage text..."
                className="w-full mt-1 p-2.5 border border-border rounded-lg text-sm bg-background"
              />
            </div>

            <div>
              <Label>Question Text *</Label>
              <Input
                value={qText}
                onChange={e => setQText(e.target.value)}
                placeholder="Enter question text..."
                className="mt-1"
              />
            </div>

            {/* Image Upload */}
            <div>
              <Label>Question Image (optional - direct file upload)</Label>
              <div className="mt-1 flex flex-col gap-2">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={qUploading}
                  className="text-xs"
                />
                {qUploading && <p className="text-xs text-muted-foreground animate-pulse">Uploading & compressing image...</p>}
                {qImageUrl && (
                  <div className="relative border rounded-xl overflow-hidden bg-black/5 p-2 flex flex-col items-center gap-2">
                    <img src={qImageUrl} alt="Uploaded preview" className="w-full max-h-48 object-contain rounded-lg shadow-sm" />
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => setQImageUrl(null)}
                      className="gap-1 text-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove Image
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Choices */}
            <div>
              <Label className="mb-2 block font-semibold">
                {qType === "true_false" ? "Select Correct Answer" : "Answer Choices & Mark Correct"}
              </Label>
              {qType === "true_false" ? (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setQChoices([{ text: "صح", isCorrect: true }, { text: "خطأ", isCorrect: false }])}
                    className={`flex-1 py-2.5 rounded-lg border-2 font-bold text-sm ${qChoices[0]?.isCorrect ? "border-green-600 bg-green-500 text-white" : "border-border hover:bg-secondary"}`}
                  >
                    صح (True) ✓
                  </button>
                  <button
                    type="button"
                    onClick={() => setQChoices([{ text: "صح", isCorrect: false }, { text: "خطأ", isCorrect: true }])}
                    className={`flex-1 py-2.5 rounded-lg border-2 font-bold text-sm ${!qChoices[0]?.isCorrect ? "border-red-600 bg-red-500 text-white" : "border-border hover:bg-secondary"}`}
                  >
                    خطأ (False) ✓
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {qChoices.map((choice, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="correctChoice"
                        checked={choice.isCorrect}
                        onChange={() => {
                          setQChoices(qChoices.map((c, i) => ({ ...c, isCorrect: i === idx })));
                        }}
                        className="w-4 h-4 text-primary"
                      />
                      <Input
                        value={choice.text}
                        onChange={e => {
                          const newChoices = [...qChoices];
                          newChoices[idx].text = e.target.value;
                          setQChoices(newChoices);
                        }}
                        placeholder={`Choice ${String.fromCharCode(65 + idx)}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setQuestionDialog(false)}>Cancel</Button>
            <Button onClick={saveQuestion} disabled={!qText.trim()}>Save Question</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Teacher Student-Preview Dialog ===== */}
      <Dialog open={previewDialog} onOpenChange={setPreviewDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto custom-scroll">
          <DialogHeader>
            <div className="flex items-center justify-between pr-6">
              <DialogTitle className="flex items-center gap-2 text-primary text-lg">
                <Eye className="w-5 h-5" /> Student View Preview / معاينة الطالب (Read-Only)
              </DialogTitle>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">Teacher Preview Mode</Badge>
            </div>
          </DialogHeader>

          {previewLoading ? (
            <div className="py-12 text-center text-muted-foreground">Loading preview...</div>
          ) : !previewData || previewData.questions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No questions found in this quiz yet.</div>
          ) : (
            <div className="space-y-6 py-2">
              <div className="bg-secondary/50 border rounded-xl p-4">
                <h3 className="font-bold text-lg">{previewData.title}</h3>
                <div className="flex gap-4 text-xs text-muted-foreground mt-2 font-mono">
                  <span>Duration: {previewData.durationMinutes} min</span>
                  <span>Questions: {previewData.questions.length}</span>
                </div>
              </div>

              <div className="space-y-6">
                {previewData.questions.map((q, idx) => (
                  <Card key={q.id || idx} className="p-5 border shadow-sm">
                    <div className="flex items-center justify-between mb-3 border-b pb-2">
                      <span className="text-xs font-semibold text-muted-foreground">Question {idx + 1} of {previewData.questions.length}</span>
                      <span className="text-xs bg-secondary px-2 py-0.5 rounded font-mono">{q.points} pt{q.points > 1 ? "s" : ""}</span>
                    </div>

                    {q.passage && (
                      <div className="mb-4 p-3.5 bg-primary/5 border border-primary/20 rounded-xl text-sm leading-relaxed whitespace-pre-wrap">
                        <span className="text-xs font-bold text-primary block mb-1">قطعة القراءة / Passage:</span>
                        {q.passage}
                      </div>
                    )}

                    <h4 className="font-semibold text-base mb-3">{q.text}</h4>

                    {q.imageUrl && (
                      <div className="my-3 rounded-xl overflow-hidden border bg-black/5 p-2 text-center">
                        <img src={q.imageUrl} alt="Question Diagram" className="w-full max-h-[450px] object-contain rounded-lg shadow-sm mx-auto" />
                      </div>
                    )}

                    <div className="mt-4">
                      {q.type === "true_false" ? (
                        <div className="flex gap-3">
                          <button disabled className="flex-1 py-3 rounded-xl border-2 font-bold text-sm border-green-600 bg-green-50 text-green-700 opacity-80 cursor-not-allowed">
                            صح (True)
                          </button>
                          <button disabled className="flex-1 py-3 rounded-xl border-2 font-bold text-sm border-red-600 bg-red-50 text-red-700 opacity-80 cursor-not-allowed">
                            خطأ (False)
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {q.choices.map((choiceText, cIdx) => (
                            <div key={cIdx} className="p-3 border rounded-xl flex items-center gap-3 bg-background opacity-90">
                              <span className="w-6 h-6 rounded-full border flex items-center justify-center font-mono text-xs font-bold text-muted-foreground">
                                {String.fromCharCode(65 + cIdx)}
                              </span>
                              <span className="text-sm font-medium">{choiceText}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDialog(false)}>Close Preview</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Footer ===== */}
      <footer className="mt-auto border-t border-border bg-card py-4">
        <div className="max-w-4xl mx-auto px-4 text-center text-xs text-muted-foreground">
          Dr. Rahma — Quiz Bank © {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}