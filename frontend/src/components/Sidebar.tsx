"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
    LayoutDashboard,
    Users,
    Megaphone,
    Search,
    Menu,
    X,
    Sun,
    Moon,
    ChevronLeft,
    LogOut,
    Shield,
    Bookmark,
    FileText
} from "lucide-react";
import { getToken, removeToken, apiFetch } from "@/lib/auth";
import { BroadcastBanner } from "./BroadcastBanner";

export function Sidebar({ children }: { children: React.ReactNode }) {
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const pathname = usePathname();
    const router = useRouter();
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [user, setUser] = useState<any>(null);
    const [status, setStatus] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setMounted(true);
        const fetchUser = async () => {
            const token = getToken();
            const isAdminRoute = pathname.startsWith('/admin');
            const isAuthRoute = pathname === '/login' || pathname === '/register' || pathname === '/admin/login';

            if (!token) {
                if (!isAuthRoute) {
                    router.push(isAdminRoute ? '/admin/login' : '/login');
                }
                setLoading(false);
                return;
            }

            try {
                const [meRes, statusRes] = await Promise.all([
                    apiFetch('/api/auth/me'),
                    apiFetch('/api/monetization/status')
                ]);

                if (meRes.ok) {
                    const data = await meRes.json();
                    setUser(data);

                    if (statusRes.ok) {
                        const sData = await statusRes.json();
                        setStatus(sData);
                    }

                    // Admin route protection
                    if (isAdminRoute && data.role !== 'admin' && pathname !== '/admin/login') {
                        router.push('/');
                    }

                    if (!data.passkey_verified && pathname !== '/verify-passkey' && !isAdminRoute) {
                        router.push('/verify-passkey');
                    }
                } else if (meRes.status === 401) {
                    removeToken();
                    router.push(isAdminRoute ? '/admin/login' : '/login');
                }
            } catch (err) {
                console.error("Auth check failed", err);
            } finally {
                setLoading(false);
            }
        };
        fetchUser();

        const updateStatus = () => {
            if (getToken()) {
                apiFetch('/api/monetization/status')
                    .then(res => res.ok ? res.json() : null)
                    .then(data => {
                        if (data) setStatus(data);
                    })
                    .catch(() => { });
            }
        };

        window.addEventListener('update_status', updateStatus);
        const intervalId = setInterval(updateStatus, 15000);

        return () => {
            window.removeEventListener('update_status', updateStatus);
            clearInterval(intervalId);
        };
    }, [pathname, router]);

    const handleLogout = () => {
        removeToken();
        const isAdminRoute = pathname.startsWith('/admin');
        router.push(isAdminRoute ? '/admin/login' : '/login');
    };

    const toggleSidebar = () => setIsMobileOpen(!isMobileOpen);
    const toggleCollapse = () => setIsCollapsed(!isCollapsed);

    const navItems = [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "Accounts", href: "/accounts", icon: Users },
        { name: "Campaigns", href: "/campaigns", icon: Megaphone },
        { name: "Scraper", href: "/scraper", icon: Search },
        { name: "Leads", href: "/leads", icon: Bookmark },
        { name: "Templates", href: "/templates", icon: FileText },
    ];

    if (user?.role === 'admin') {
        navItems.push({ name: "Admin Panel", href: "/admin", icon: Shield });
    }

    if (!mounted) return null;

    const noSidebarRoutes = ['/login', '/register', '/verify-passkey', '/admin/login'];
    if (noSidebarRoutes.includes(pathname)) {
        return <div className="w-full min-h-screen">{children}</div>;
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen w-full bg-background font-sans">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                    <p className="text-foreground/40 text-sm font-medium animate-pulse">Initializing ArkiTel...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex w-full min-h-screen">
            {/* Mobile Topbar */}
            <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-background/80 backdrop-blur-3xl border-b border-border flex items-center justify-between px-4 z-50">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                    </div>
                    <h1 className="text-sm font-semibold tracking-wider text-foreground">ARKITEL</h1>
                </div>
                <button onClick={toggleSidebar} className="p-2 text-foreground/70 hover:text-foreground">
                    {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
            </div>

            {/* Sidebar Overlay (Mobile) */}
            {isMobileOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                    onClick={() => setIsMobileOpen(false)}
                />
            )}

            {/* Main Sidebar */}
            <nav className={`
        fixed top-0 left-0 h-full bg-background/90 md:bg-background/80 backdrop-blur-3xl 
        border-r border-border flex flex-col pt-20 md:pt-5 z-50 transition-all duration-300
        ${isMobileOpen ? "translate-x-0 w-64" : "-translate-x-full md:translate-x-0"}
        ${isCollapsed ? "md:w-20" : "md:w-56"}
      `}>
                {/* Logo Area (Desktop) */}
                <div className={`hidden md:flex items-center gap-3 mb-10 px-6 ${isCollapsed ? "justify-center px-0" : ""}`}>
                    <div className="w-8 h-8 min-w-[32px] rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                    </div>
                    {!isCollapsed && <h1 className="text-sm font-semibold tracking-wider text-foreground animate-in fade-in duration-300">ARKITEL</h1>}
                </div>

                {/* Collapse Button */}
                <button
                    onClick={toggleCollapse}
                    className="hidden md:flex absolute -right-3 top-7 w-6 h-6 bg-indigo-500 rounded-full items-center justify-center text-white shadow-lg hover:scale-110 transition-transform z-50"
                >
                    <ChevronLeft size={14} className={`transition-transform duration-300 ${isCollapsed ? "rotate-180" : ""}`} />
                </button>

                {/* Navigation Links */}
                <div className="space-y-1.5 flex-1 px-3 overflow-y-auto overflow-x-hidden custom-scrollbar">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                onClick={() => setIsMobileOpen(false)}
                                className={`
                  flex items-center gap-3 py-3 rounded-xl text-sm font-medium transition-all group
                  ${isCollapsed ? "justify-center px-0" : "px-4"}
                  ${isActive
                                        ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                                        : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"}
                `}
                                title={isCollapsed ? item.name : ""}
                            >
                                <item.icon size={20} className={isActive ? "text-indigo-600 dark:text-indigo-400" : "text-foreground/50 group-hover:text-foreground/80"} />
                                {!isCollapsed && <span className="animate-in fade-in duration-300">{item.name}</span>}
                            </Link>
                        );
                    })}
                </div>

                {/* Theme Toggle & Logout */}
                <div className="p-4 border-t border-border space-y-1">
                    <button
                        onClick={handleLogout}
                        className={`
                flex items-center gap-3 py-3 w-full rounded-xl text-sm font-medium transition-all text-red-500/60 hover:text-red-500 hover:bg-red-500/10
                ${isCollapsed ? "justify-center px-0" : "px-4"}
              `}
                        title={isCollapsed ? "Logout" : ""}
                    >
                        <LogOut size={20} />
                        {!isCollapsed && <span className="animate-in fade-in duration-300">Logout</span>}
                    </button>

                    {!isCollapsed && user && (
                        <div className="px-4 py-2 mt-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="text-[10px] text-foreground/30 uppercase tracking-[0.2em] font-bold">System Status</div>
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border border-current uppercase ${status?.plan === 'unlimited' ? 'text-rose-400 bg-rose-500/10' :
                                        status?.plan === 'premium' ? 'text-indigo-400 bg-indigo-500/10' :
                                            status?.plan === 'standard' ? 'text-amber-400 bg-amber-500/10' :
                                                status?.plan === 'basic' ? 'text-emerald-400 bg-emerald-500/10' :
                                                    'text-foreground/40 bg-foreground/5'
                                    }`}>
                                    {status?.plan || 'Free'}
                                </span>
                            </div>

                            {status?.plan === 'free' && (
                                <Link href="/scraper" className="block w-full text-center py-2 bg-indigo-500/10 hover:bg-indigo-500 text-indigo-500 hover:text-white text-[10px] font-black tracking-widest rounded-lg transition-all border border-indigo-500/20 shadow-lg shadow-indigo-500/10">
                                    UPGRADE NOW
                                </Link>
                            )}

                            <div className="space-y-3 pt-2">
                                {/* Templates usage - Global visibility */}
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[9px] font-bold text-foreground/30 uppercase">
                                        <span>Templates Saved</span>
                                        <span>{status?.template_count || 0} / {status?.max_templates || 1}</span>
                                    </div>
                                    <div className="h-1 w-full bg-foreground/5 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-indigo-500 transition-all duration-1000"
                                            style={{ width: `${Math.min(100, ((status?.template_count || 0) / (status?.max_templates || 1)) * 100)}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Campaigns Limit */}
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[9px] font-bold text-foreground/30 uppercase">
                                        <span>Daily Campaigns</span>
                                        <span>{status?.daily_campaign_count || 0} / {status?.max_daily_campaigns || 20}</span>
                                    </div>
                                    <div className="h-1 w-full bg-foreground/5 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-blue-500 transition-all duration-1000"
                                            style={{ width: `${Math.min(100, ((status?.daily_campaign_count || 0) / (status?.max_daily_campaigns || 20)) * 100)}%` }}
                                        />
                                    </div>
                                </div>

                                {status?.plan !== 'free' && (
                                    <>
                                        {/* Keyword Limit */}
                                        <div className="space-y-1">
                                            <div className="flex justify-between text-[9px] font-bold text-foreground/30 uppercase">
                                                <span>Keywords Searched</span>
                                                <span>{status?.daily_keyword_count || 0} / {status?.max_daily_keywords || 5}</span>
                                            </div>
                                            <div className="h-1 w-full bg-foreground/5 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-emerald-500 transition-all duration-1000"
                                                    style={{ width: `${Math.min(100, ((status?.daily_keyword_count || 0) / (status?.max_daily_keywords || 5)) * 100)}%` }}
                                                />
                                            </div>
                                        </div>

                                        {/* Scrape Power */}
                                        <div className="flex justify-between text-[9px] font-bold text-foreground/30 uppercase pt-1">
                                            <span>Scrape Limit</span>
                                            <span className="text-foreground/60">{status?.scrape_limit || 50} / search</span>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="pt-2 border-t border-border/50">
                                <div className="text-[10px] text-foreground/30 uppercase tracking-[0.2em] font-bold">Session</div>
                                <div className="text-xs text-foreground/60 font-semibold truncate mt-0.5">{user.username}</div>
                            </div>
                        </div>
                    )}
                </div>
            </nav>

            {/* Main Content Wrapper */}
            <main className={`
        flex-1 min-h-screen pt-20 md:pt-0 transition-all duration-300
        ${isCollapsed ? "md:ml-20" : "md:ml-56"}
      `}>
                <div className="p-4 md:p-8 max-w-7xl mx-auto">
                    <BroadcastBanner />
                    {children}
                </div>
            </main>
        </div>
    );
}
