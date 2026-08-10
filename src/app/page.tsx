"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, Clock, CheckCircle2, XCircle, LogIn, LogOut, UserPlus,
  LayoutDashboard, Shield, Plus, Trash2, Edit3, Upload, FileText,
  ChevronLeft, ChevronRight, ArrowRight, BarChart3, Timer,
  AlertTriangle, Eye, Play, Save, Send, Menu, X, Home,
  FolderOpen, HelpCircle, Award, Users, Settings
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
type Quiz = { id: string; title: string; description: string | null; durationMinutes: number; questionCount: number; attemptCount: number; subjectName: string; order: number; status: string | null };
type QuizQuestion = { id: string; text: string; imageUrl: string | null; points: number; choices: string[] };
type ReviewQuestion = { id: string; text: string; imageUrl: string | null; points: number; choices: { id: string; text: string; isCorrect: boolean }[]; correct: number; picked: number | null };
type AttemptResult = { id: string; score: number; totalPoints: number; startedAt: string; submittedAt: string; quiz: { id: string; title: string; subjectName: string }; percent: number };
type ImportQuestion = { text: string; imageUrl: string | null; choices: { text: string; isCorrect: boolean }[] };

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
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
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
  const [quizSubjectId, setQuizSubjectId] = useState("");
  const [importDialog, setImportDialog] = useState(false);
  const [importQuizId, setImportQuizId] = useState("");
  const [importPreview, setImportPreview] = useState<ImportQuestion[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const confirmFileRef = useRef<HTMLInputElement>(null);

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

  // Load dashboard attempts
  const loadDashboard = useCallback(async () => {
    if (!user) return;
    const data = await api(`/api/attempts?type=dashboard`);
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
      setView("home");
      toast.success(data.user.role === "admin" ? "تم تسجيل الدخول كأدمن" : "تم تسجيل الدخول بنجاح");
      setAuthEmail(""); setAuthPassword(""); setAuthName("");
    } else {
      toast.error(data.error || "حدث خطأ");
    }
    setAuthLoading(false);
  };

  const logout = () => {
    localStorage.removeItem("quiz_token");
    setUser(null);
    setView("home");
    setMobileMenuOpen(false);
    toast.success("تم تسجيل الخروج");
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
      if (!confirm(`لا يزال لديك ${unanswered} سؤال بدون إجابة. هل تريد التسليم كما هو؟`)) return;
    }
    try {
      await api("/api/attempts", {
        method: "POST",
        body: JSON.stringify({ action: "submit", attemptId, answers: quizAnswers, auto }),
      });
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
      if (data.status === "saved") toast.success("تم الحفظ");
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
    if (!subjectName.trim()) { toast.error("اسم المادة مطلوب"); return; }
    if (editSubject) {
      await api("/api/subjects", { method: "PUT", body: JSON.stringify({ id: editSubject.id, name: subjectName, description: subjectDesc }) });
      toast.success("تم تعديل المادة");
    } else {
      await api("/api/subjects", { method: "POST", body: JSON.stringify({ name: subjectName, description: subjectDesc }) });
      toast.success("تم إضافة المادة");
    }
    setSubjectDialog(false);
    setEditSubject(null);
    setSubjectName(""); setSubjectDesc("");
    loadSubjects();
  };

  // Admin: Delete subject
  const deleteSubject = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذه المادة وجميع اختباراتها؟")) return;
    const data = await api(`/api/subjects?id=${id}`, { method: "DELETE" });
    if (data.error) { toast.error(data.error); return; }
    toast.success("تم حذف المادة");
    loadSubjects();
  };

  // Admin: Save quiz
  const saveQuiz = async () => {
    if (!quizTitle.trim() || !quizSubjectId) { toast.error("بيانات غير مكتملة"); return; }
    if (editQuiz) {
      await api("/api/quizzes", { method: "PUT", body: JSON.stringify({ id: editQuiz.id, title: quizTitle, description: quizDesc, durationMinutes: parseInt(quizDuration) || 40 }) });
      toast.success("تم تعديل الاختبار");
    } else {
      await api("/api/quizzes", { method: "POST", body: JSON.stringify({ title: quizTitle, description: quizDesc, durationMinutes: parseInt(quizDuration) || 40, subjectId: quizSubjectId }) });
      toast.success("تم إضافة الاختبار");
    }
    setQuizDialog(false);
    setEditQuiz(null);
    setQuizTitle(""); setQuizDesc(""); setQuizDuration("40");
    loadSubjects();
  };

  // Admin: Delete quiz
  const deleteQuiz = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذا الاختبار؟")) return;
    await api(`/api/quizzes?id=${id}`, { method: "DELETE" });
    toast.success("تم حذف الاختبار");
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
      toast.success(`تم استخراج ${data.count} سؤال`);
    } else {
      toast.error(data.error || "فشل الاستيراد");
    }
    setImportLoading(false);
  };

  // Admin: Confirm import
  const confirmImport = async () => {
    if (!importQuizId || !importPreview.length) return;
    setImportLoading(true);
    const fd = new FormData();
    if (confirmFileRef.current?.files?.[0]) {
      fd.append("file", confirmFileRef.current.files[0]);
    }
    fd.append("quizId", importQuizId);
    fd.append("action", "confirm");
    fd.append("questions", JSON.stringify(importPreview));
    const data = await api("/api/import", { method: "POST", body: fd });
    if (data.status === "imported") {
      toast.success(`تم استيراد ${data.count} سؤال بنجاح`);
      setImportDialog(false);
      setImportPreview([]);
      loadSubjects();
    } else {
      toast.error(data.error || "فشل الاستيراد");
    }
    setImportLoading(false);
  };

  // Navigation helper
  const goHome = () => { setView("home"); setCurrentSubject(null); setMobileMenuOpen(false); };
  const goToSubject = (subject: Subject) => {
    setCurrentSubject(subject);
    loadSubjectQuizzes(subject.id);
    setView("subject");
    setMobileMenuOpen(false);
  };
  const goToDashboard = () => {
    loadDashboard();
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
          <p className="text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  // ==================== RENDER ====================
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top Bar */}
      <header className="sticky top-0 z-50 bg-card border-b border-border shadow-sm">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => { if (view !== "home") { goHome(); } else { setMobileMenuOpen(!mobileMenuOpen); } }} className="p-2 rounded-lg hover:bg-secondary transition-colors">
              {view !== "home" ? <ChevronRight className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <button onClick={goHome} className="font-bold text-lg hover:opacity-80 transition-opacity">
              د. رحمة <span className="text-primary">·</span> بنك الأسئلة
            </button>
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                {user.role === "student" && (
                  <Button variant="ghost" size="sm" onClick={goToDashboard} className="gap-1.5 text-sm">
                    <LayoutDashboard className="w-4 h-4" />
                    <span className="hidden sm:inline">نتائجي</span>
                  </Button>
                )}
                {user.role === "admin" && (
                  <Button variant="ghost" size="sm" onClick={goToAdmin} className="gap-1.5 text-sm">
                    <Shield className="w-4 h-4" />
                    <span className="hidden sm:inline">لوحة التحكم</span>
                  </Button>
                )}
                <div className="w-px h-6 bg-border mx-1" />
                <Button variant="ghost" size="sm" onClick={logout} className="gap-1.5 text-sm text-destructive">
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">خروج</span>
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setView("auth")} className="gap-1.5">
                <LogIn className="w-4 h-4" />
                <span>دخول</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && view === "home" && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-14 right-0 left-0 z-40 bg-card border-b border-border shadow-lg p-4"
          >
            <div className="flex flex-col gap-2">
              {user?.role === "student" && (
                <Button variant="ghost" className="justify-start gap-2" onClick={goToDashboard}>
                  <LayoutDashboard className="w-4 h-4" /> نتائجي
                </Button>
              )}
              {user?.role === "admin" && (
                <Button variant="ghost" className="justify-start gap-2" onClick={goToAdmin}>
                  <Shield className="w-4 h-4" /> لوحة التحكم
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1">
        <AnimatePresence mode="wait">
          {/* ============ HOME VIEW ============ */}
          {view === "home" && (
            <motion.div key="home" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-4xl mx-auto px-4 py-6">
              <div className="mb-6">
                <h1 className="text-2xl font-bold mb-1">المواد الدراسية</h1>
                <p className="text-muted-foreground text-sm">اختر مادة لعرض الاختبارات المتاحة</p>
              </div>

              {totalPending > 0 && user?.role === "student" && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="mb-4 p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-primary" />
                  <span>باقيلك <strong>{totalPending}</strong> اختبار لسه ما حليتهاش</span>
                </motion.div>
              )}

              {subjects.length === 0 ? (
                <Card className="p-6 text-center">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">لا توجد مواد بعد. يمكن إضافتها من لوحة التحكم.</p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {subjects.map((subject, i) => (
                    <motion.button key={subject.id}
                      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                      onClick={() => goToSubject(subject)}
                      className="bg-card border border-border rounded-xl p-5 text-right hover:border-primary hover:shadow-md transition-all group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <FolderOpen className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                        <h3 className="font-semibold text-base">{subject.name}</h3>
                      </div>
                      {subject.description && (
                        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{subject.description}</p>
                      )}
                      <div className="flex gap-4 text-sm">
                        <div className="font-mono text-primary font-semibold">{subject.quizCount}<span className="block text-xs text-muted-foreground font-sans font-normal">اختبار</span></div>
                        {user?.role === "student" && subject.pendingQuizzes > 0 && (
                          <div className="font-mono text-destructive font-semibold">{subject.pendingQuizzes}<span className="block text-xs text-muted-foreground font-sans font-normal">متبقي</span></div>
                        )}
                      </div>
                    </motion.button>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ============ SUBJECT VIEW ============ */}
          {view === "subject" && currentSubject && (
            <motion.div key="subject" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-4xl mx-auto px-4 py-6">
              <div className="mb-6">
                <h1 className="text-2xl font-bold mb-1">{currentSubject.name}</h1>
                {currentSubject.description && <p className="text-muted-foreground text-sm">{currentSubject.description}</p>}
              </div>

              {quizzes.length === 0 ? (
                <Card className="p-6 text-center">
                  <HelpCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">لا توجد اختبارات في هذه المادة بعد.</p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {quizzes.map((quiz, i) => (
                    <motion.div key={quiz.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                      className="bg-card border border-border rounded-xl p-4 sm:p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <h3 className="font-semibold mb-1">{quiz.title}</h3>
                          {quiz.description && <p className="text-sm text-muted-foreground mb-2">{quiz.description}</p>}
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><HelpCircle className="w-3.5 h-3.5" /> {quiz.questionCount} سؤال</span>
                            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {quiz.durationMinutes} دقيقة</span>
                          </div>
                        </div>
                        {quiz.status === "submitted" ? (
                          <Badge variant="secondary" className="bg-green-100 text-green-700 shrink-0">مكتمل ✓</Badge>
                        ) : (
                          <Button onClick={() => startQuiz(quiz.id)} size="sm" className="shrink-0 gap-1.5">
                            <Play className="w-4 h-4" /> ابدأ
                          </Button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ============ QUIZ VIEW ============ */}
          {view === "quiz" && (
            <motion.div key="quiz" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-4xl mx-auto px-4 py-6">
              {/* Quiz Header */}
              <div className="bg-card border border-border rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h1 className="font-bold text-lg">{quizData?.quiz.title || "الاختبار"}</h1>
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
                      <div><span className="block font-mono text-xl text-primary">{quizData.questions.length}</span><span className="text-xs text-muted-foreground">سؤال</span></div>
                      <div><span className="block font-mono text-xl text-primary">{quizData.quiz.durationMinutes}:00</span><span className="text-xs text-muted-foreground">الوقت المسموح</span></div>
                      <div><span className="block font-mono text-xl text-primary">{quizData.questions.reduce((s, q) => s + q.points, 0)}</span><span className="text-xs text-muted-foreground">درجة</span></div>
                    </div>
                    <p className="text-sm text-muted-foreground bg-secondary rounded-lg p-3 border-r-4 border-primary">
                      إجاباتك تُحفظ تلقائيًا كل بضع ثوانٍ. عند انتهاء الوقت يتم التسليم تلقائيًا. الاختبار يمكن حله مرة واحدة فقط.
                    </p>
                    <Button onClick={() => startQuiz(quizData.quiz.id)} className="mt-4 gap-2 w-full sm:w-auto">
                      <Play className="w-4 h-4" /> ابدأ الاختبار ({quizData.quiz.durationMinutes} دقيقة)
                    </Button>
                  </div>
                )}
              </div>

              {/* Progress */}
              {quizStarted && !quizSubmitted && (
                <div className="mb-4">
                  <Progress value={quizAnswers.filter(a => a !== null).length / (quizData?.questions.length || 1) * 100} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>{quizAnswers.filter(a => a !== null).length} / {quizData?.questions.length} تم الإجابة</span>
                    <span></span>
                  </div>
                </div>
              )}

              {/* Questions */}
              {quizStarted && !quizSubmitted && quizData && (
                <div className="space-y-4">
                  {quizData.questions.map((q, qi) => (
                    <motion.div key={q.id} id={`q-${qi}`} className={`bg-card border rounded-xl p-4 scroll-mt-40 transition-colors ${quizAnswers[qi] !== null ? "border-primary" : "border-border"}`}>
                      {q.imageUrl && (
                        <div className="mb-3 rounded-lg overflow-hidden bg-secondary">
                          <img src={q.imageUrl} alt="صورة السؤال" className="max-h-64 w-auto mx-auto object-contain" />
                        </div>
                      )}
                      <div className="flex items-start gap-2 mb-3">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-secondary text-primary text-xs font-bold shrink-0 mt-0.5">{qi + 1}</span>
                        <p className="font-medium text-sm leading-relaxed">{q.text}{q.points > 1 ? ` (${q.points} درجة)` : ""}</p>
                      </div>
                      <div className="space-y-1.5 mr-8">
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
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Submit Bar */}
              {quizStarted && !quizSubmitted && (
                <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm pt-4 pb-2 mt-4">
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={saveProgress} className="gap-1.5"><Save className="w-4 h-4" /> حفظ</Button>
                    <Button onClick={() => submitQuiz(false)} className="flex-1 gap-1.5"><Send className="w-4 h-4" /> تسليم الاختبار</Button>
                  </div>
                </div>
              )}

              {/* Review Results */}
              {quizSubmitted && reviewData && (
                <div>
                  <div className="bg-card border border-border rounded-xl p-6 text-center mb-6">
                    <Award className="w-12 h-12 mx-auto mb-3 text-primary" />
                    <div className="font-mono text-4xl font-bold text-primary">{reviewData.score} / {reviewData.totalPoints}</div>
                    <p className="text-muted-foreground mt-1">{reviewData.percent}% صحيح</p>
                  </div>
                  <div className="space-y-4">
                    {reviewData.questions.map((q, qi) => {
                      const isCorrect = q.picked === q.correct;
                      return (
                        <div key={q.id} className={`bg-card border rounded-xl p-4 ${isCorrect ? "border-green-500 bg-green-50" : "border-red-400 bg-red-50"}`}>
                          <div className={`text-xs font-bold uppercase tracking-wide mb-2 ${isCorrect ? "text-green-600" : "text-red-600"}`}>
                            {isCorrect ? "✓ صحيح" : (q.picked === null ? "لم يتم الإجابة" : "✗ خطأ")}
                          </div>
                          {q.imageUrl && (
                            <div className="mb-3 rounded-lg overflow-hidden bg-white">
                              <img src={q.imageUrl} alt="صورة السؤال" className="max-h-48 w-auto mx-auto object-contain" />
                            </div>
                          )}
                          <div className="flex items-start gap-2 mb-3">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-white text-primary text-xs font-bold shrink-0">{qi + 1}</span>
                            <p className="font-medium text-sm">{q.text}</p>
                          </div>
                          <div className="space-y-1.5 mr-8">
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
                    <Button onClick={goHome} className="gap-2">العودة للرئيسية</Button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ============ DASHBOARD VIEW ============ */}
          {view === "dashboard" && user?.role === "student" && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-4xl mx-auto px-4 py-6">
              <div className="mb-6">
                <h1 className="text-2xl font-bold mb-1">لوحة نتائجي</h1>
                <p className="text-muted-foreground text-sm">مرحباً {user.name || user.email}</p>
              </div>

              {totalPending > 0 && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="mb-4 p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-primary" />
                  <span>باقيلك <strong>{totalPending}</strong> اختبار لسه ما حليتهاش</span>
                  <Button variant="ghost" size="sm" onClick={goHome} className="mr-auto text-primary">عرض المواد</Button>
                </motion.div>
              )}

              {attempts.length === 0 ? (
                <Card className="p-6 text-center">
                  <BarChart3 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">لا توجد نتائج بعد. ابدأ بحل اختبار!</p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {attempts.map((attempt, i) => (
                    <motion.div key={attempt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                      className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm truncate">{attempt.quiz.title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{attempt.quiz.subjectName} • {new Date(attempt.submittedAt).toLocaleDateString("ar-EG")}</p>
                      </div>
                      <div className="text-center shrink-0">
                        <div className={`font-mono text-xl font-bold ${attempt.percent >= 60 ? "text-green-600" : "text-destructive"}`}>{attempt.percent}%</div>
                        <div className="text-xs text-muted-foreground">{attempt.score}/{attempt.totalPoints}</div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => showReview(attempt.id)} className="shrink-0 gap-1">
                        <Eye className="w-4 h-4" /> مراجعة
                      </Button>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ============ AUTH VIEW ============ */}
          {view === "auth" && !user && (
            <motion.div key="auth" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="max-w-sm mx-auto px-4 py-16">
              <Card className="p-6">
                <div className="text-center mb-6">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    {authMode === "login" ? <LogIn className="w-6 h-6 text-primary" /> : <UserPlus className="w-6 h-6 text-primary" />}
                  </div>
                  <h2 className="text-xl font-bold">{authMode === "login" ? "تسجيل الدخول" : "حساب جديد"}</h2>
                </div>

                <div className="space-y-4">
                  {authMode === "register" && (
                    <div>
                      <Label>الاسم</Label>
                      <Input placeholder="الاسم الكامل" value={authName} onChange={e => setAuthName(e.target.value)} className="mt-1" />
                    </div>
                  )}
                  <div>
                    <Label>البريد الإلكتروني</Label>
                    <Input type="email" placeholder="example@email.com" value={authEmail} onChange={e => setAuthEmail(e.target.value)} className="mt-1" dir="ltr" />
                  </div>
                  <div>
                    <Label>كلمة السر</Label>
                    <Input type="password" placeholder="••••••••" value={authPassword} onChange={e => setAuthPassword(e.target.value)} className="mt-1" dir="ltr" />
                  </div>
                  <Button onClick={handleAuth} disabled={authLoading || !authEmail || !authPassword} className="w-full gap-2">
                    {authLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
                    {authMode === "login" ? "تسجيل الدخول" : "إنشاء حساب"}
                  </Button>
                </div>

                <div className="mt-4 text-center text-sm">
                  <button onClick={() => setAuthMode(authMode === "login" ? "register" : "login")} className="text-primary font-semibold hover:underline">
                    {authMode === "login" ? "ليس لديك حساب؟ سجل الآن" : "لديك حساب؟ سجل دخول"}
                  </button>
                </div>
              </Card>
            </motion.div>
          )}

          {/* ============ ADMIN VIEW ============ */}
          {view === "admin" && user?.role === "admin" && (
            <motion.div key="admin" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-4xl mx-auto px-4 py-6">
              <div className="mb-6">
                <h1 className="text-2xl font-bold mb-1">لوحة التحكم</h1>
                <p className="text-muted-foreground text-sm">مرحباً {user.name || user.email} — إدارة المواد والاختبارات</p>
              </div>

              <Tabs value={adminTab} onValueChange={setAdminTab}>
                <TabsList className="w-full mb-6">
                  <TabsTrigger value="subjects" className="flex-1 gap-1.5"><FolderOpen className="w-4 h-4" /> المواد</TabsTrigger>
                  <TabsTrigger value="quizzes" className="flex-1 gap-1.5"><FileText className="w-4 h-4" /> الاختبارات</TabsTrigger>
                  <TabsTrigger value="import" className="flex-1 gap-1.5"><Upload className="w-4 h-4" /> استيراد</TabsTrigger>
                </TabsList>

                {/* Subjects Tab */}
                <TabsContent value="subjects">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold">المواد ({subjects.length})</h2>
                    <Button size="sm" onClick={() => { setEditSubject(null); setSubjectName(""); setSubjectDesc(""); setSubjectDialog(true); }} className="gap-1.5">
                      <Plus className="w-4 h-4" /> إضافة مادة
                    </Button>
                  </div>
                  {subjects.length === 0 ? (
                    <Card className="p-6 text-center text-muted-foreground">لا توجد مواد بعد</Card>
                  ) : (
                    <div className="space-y-2">
                      {subjects.map((s) => (
                        <div key={s.id} className="bg-card border border-border rounded-lg p-3 flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-sm">{s.name}</h3>
                            <p className="text-xs text-muted-foreground">{s.description || "بدون وصف"} • {s.quizCount} اختبار</p>
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
                    <h2 className="font-semibold">الاختبارات</h2>
                    <Button size="sm" onClick={() => { setEditQuiz(null); setQuizTitle(""); setQuizDesc(""); setQuizDuration("40"); setQuizSubjectId(subjects[0]?.id || ""); setQuizDialog(true); }} className="gap-1.5">
                      <Plus className="w-4 h-4" /> إضافة اختبار
                    </Button>
                  </div>
                  {subjects.length === 0 ? (
                    <Card className="p-6 text-center text-muted-foreground">أضف مواد أولاً ثم أنشئ اختبارات</Card>
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
                                  <p className="text-xs text-muted-foreground">{q.questionCount} سؤال • {q.durationMinutes} دقيقة • {q.attemptCount} محاولة</p>
                                </div>
                                <div className="flex gap-1">
                                  <Button variant="ghost" size="sm" onClick={() => { setEditQuiz(q); setQuizTitle(q.title); setQuizDesc(q.description || ""); setQuizDuration(String(q.durationMinutes)); setQuizSubjectId(s.id); setQuizDialog(true); }}><Edit3 className="w-4 h-4" /></Button>
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
                    <h2 className="font-semibold mb-1">استيراد أسئلة</h2>
                    <p className="text-sm text-muted-foreground">ارفع ملف وورد (docx) أو إكسل (xlsx) لاستيراد الأسئلة تلقائيًا</p>
                  </div>
                  <Card className="p-5">
                    <div className="space-y-4">
                      <div>
                        <Label>اختر الاختبار</Label>
                        <select value={importQuizId} onChange={e => setImportQuizId(e.target.value)} className="w-full mt-1 p-2.5 border border-border rounded-lg text-sm bg-background">
                          <option value="">-- اختر اختبار --</option>
                          {subjects.flatMap(s => s.quizzes.map(q => ({ ...q, subjectName: s.name }))).map(q => (
                            <option key={q.id} value={q.id}>{q.subjectName} — {q.title}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label>رفع ملف</Label>
                        <div className="mt-1 border-2 border-dashed border-border rounded-lg p-6 text-center">
                          <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground mb-2">اسحب الملف هنا أو انقر للاختيار</p>
                          <input ref={importFileRef} type="file" accept=".docx,.xlsx,.xls" onChange={handleImportPreview} className="text-sm" />
                        </div>
                      </div>

                      {importLoading && <div className="text-center text-sm text-muted-foreground">جاري التحليل...</div>}

                      {importPreview.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="font-semibold text-sm">معاينة ({importPreview.length} سؤال)</h3>
                          </div>
                          <div className="max-h-96 overflow-y-auto custom-scroll space-y-2 border border-border rounded-lg p-3">
                            {importPreview.map((q, i) => (
                              <div key={i} className="bg-secondary/50 rounded-lg p-3">
                                <div className="flex items-start gap-2 mb-2">
                                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold shrink-0">{i + 1}</span>
                                  <p className="text-sm font-medium">{q.text}</p>
                                </div>
                                {q.imageUrl && <img src={q.imageUrl} alt="" className="max-h-32 rounded-lg mb-2" />}
                                <div className="mr-7 space-y-1">
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
                              تأكيد الاستيراد
                            </Button>
                            <Button variant="outline" onClick={() => setImportPreview([])}>إلغاء</Button>
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

      {/* Subject Dialog */}
      <Dialog open={subjectDialog} onOpenChange={setSubjectDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editSubject ? "تعديل المادة" : "إضافة مادة جديدة"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>اسم المادة</Label><Input value={subjectName} onChange={e => setSubjectName(e.target.value)} placeholder="مثال: التشريح" className="mt-1" /></div>
            <div><Label>الوصف (اختياري)</Label><Input value={subjectDesc} onChange={e => setSubjectDesc(e.target.value)} placeholder="وصف مختصر للمادة" className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubjectDialog(false)}>إلغاء</Button>
            <Button onClick={saveSubject} disabled={!subjectName.trim()}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quiz Dialog */}
      <Dialog open={quizDialog} onOpenChange={setQuizDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editQuiz ? "تعديل الاختبار" : "إضافة اختبار جديد"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>المادة</Label>
              <select value={quizSubjectId} onChange={e => setQuizSubjectId(e.target.value)} className="w-full mt-1 p-2.5 border border-border rounded-lg text-sm bg-background">
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div><Label>عنوان الاختبار</Label><Input value={quizTitle} onChange={e => setQuizTitle(e.target.value)} placeholder="مثال: اختبار الوحدة الأولى" className="mt-1" /></div>
            <div><Label>الوصف (اختياري)</Label><Input value={quizDesc} onChange={e => setQuizDesc(e.target.value)} placeholder="وصف مختصر" className="mt-1" /></div>
            <div><Label>مدة الاختبار (دقيقة)</Label><Input type="number" value={quizDuration} onChange={e => setQuizDuration(e.target.value)} className="mt-1" dir="ltr" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuizDialog(false)}>إلغاء</Button>
            <Button onClick={saveQuiz} disabled={!quizTitle.trim() || !quizSubjectId}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <footer className="mt-auto border-t border-border bg-card py-4">
        <div className="max-w-4xl mx-auto px-4 text-center text-xs text-muted-foreground">
          د. رحمة — بنك الأسئلة © {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}
