"use client";

import React, { useState, useEffect } from 'react';
import { Plus, FileText, Trash2, Edit3, Loader2, CheckCircle2, AlertCircle, Search } from 'lucide-react';
import { apiFetch } from '@/lib/auth';

interface Template {
    id: number;
    name: string;
    content: string;
}

export default function TemplatesPage() {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    const [formData, setFormData] = useState({
        name: '',
        content: ''
    });

    const fetchTemplates = async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/api/telegram/templates');
            if (res.ok) {
                const data = await res.json();
                setTemplates(data.templates || []);
            }
        } catch (err) {
            console.error("Failed to fetch templates", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTemplates();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const res = await apiFetch('/api/telegram/templates', {
                method: 'POST',
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                setSuccess(true);
                setFormData({ name: '', content: '' });
                fetchTemplates();
                setTimeout(() => {
                    setIsCreating(false);
                    setSuccess(false);
                }, 1500);
            } else {
                const data = await res.json();
                setError(data.detail || "Failed to save template");
            }
        } catch (err) {
            setError("Network error occurred");
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure you want to delete this template?")) return;
        
        try {
            const res = await apiFetch(`/api/telegram/templates/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                fetchTemplates();
            }
        } catch (err) {
            console.error("Delete failed", err);
        }
    };

    const filteredTemplates = templates.filter(t => 
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        t.content.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h1 className="text-4xl font-black text-foreground tracking-tight mb-2">
                        Message <span className="text-indigo-500">Templates</span>
                    </h1>
                    <p className="text-foreground/40 font-medium">Manage and organize your mission-critical message snippets.</p>
                </div>
                <button 
                    onClick={() => { setIsCreating(true); setEditingId(null); setFormData({ name: '', content: '' }); }}
                    className="flex items-center gap-3 bg-indigo-500 hover:bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold shadow-xl shadow-indigo-500/20 transition-all hover:scale-[1.02] active:scale-95 shrink-0"
                >
                    <Plus size={20} />
                    Create New Snippet
                </button>
            </div>

            {/* Main Content */}
            <div className="grid grid-cols-1 gap-6">
                <div className="relative group">
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-foreground/20 group-focus-within:text-indigo-500 transition-colors">
                        <Search size={20} />
                    </div>
                    <input 
                        type="text" 
                        placeholder="Search your knowledge base..."
                        className="w-full bg-card border border-border rounded-2xl py-5 pl-14 pr-6 text-foreground placeholder:text-foreground/20 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all shadow-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                {loading && templates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-card rounded-[32px] border border-border border-dashed">
                        <Loader2 className="animate-spin text-indigo-500 mb-4" size={32} />
                        <p className="text-foreground/30 font-bold uppercase tracking-widest text-xs">Accessing Archives...</p>
                    </div>
                ) : filteredTemplates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-card rounded-[32px] border border-border">
                        <div className="p-6 bg-foreground/5 rounded-full mb-6">
                            <FileText size={48} className="text-foreground/10" />
                        </div>
                        <h3 className="text-xl font-bold text-foreground mb-2">No Templates Found</h3>
                        <p className="text-foreground/40 max-w-md text-center text-sm px-6">Your message library is empty. Start by creating a high-converting template for your next campaign.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredTemplates.map((template) => (
                            <div 
                                key={template.id}
                                className="bg-card border border-border rounded-[32px] p-8 hover:border-indigo-500/30 transition-all group relative overflow-hidden flex flex-col h-full shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 transition-all duration-500"
                            >
                                <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button 
                                        onClick={() => handleDelete(template.id)}
                                        className="p-2.5 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-lg shadow-red-500/10"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                <div className="p-3 w-fit bg-indigo-500/10 rounded-2xl text-indigo-500 mb-6 group-hover:bg-indigo-500 group-hover:text-white transition-all duration-500">
                                    <FileText size={24} />
                                </div>
                                <h4 className="text-xl font-bold text-foreground mb-4 line-clamp-1">{template.name}</h4>
                                <div className="flex-1 bg-foreground/[0.02] border border-border rounded-2xl p-5 mb-6">
                                    <p className="text-xs text-foreground/50 leading-loose line-clamp-6 font-medium italic">
                                        "{template.content}"
                                    </p>
                                </div>
                                <div className="flex items-center justify-between pt-2">
                                    <span className="text-[10px] font-bold text-foreground/20 uppercase tracking-widest">Storage: Local Disk</span>
                                    <button 
                                        onClick={() => {
                                            setFormData({ name: template.name, content: template.content });
                                            setEditingId(template.id);
                                            setIsCreating(true);
                                        }}
                                        className="text-[10px] font-black text-indigo-500 uppercase tracking-widest hover:text-indigo-400 flex items-center gap-2"
                                    >
                                        Edit Snippet <Edit3 size={12} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Creator Modal */}
            {isCreating && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
                    <div className="bg-card border border-border rounded-[32px] w-full max-w-2xl shadow-2xl relative animate-in zoom-in-95 duration-300 overflow-hidden">
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-[2px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent"></div>
                        
                        <div className="p-10">
                            {success ? (
                                <div className="text-center py-10">
                                    <div className="w-20 h-20 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
                                        <CheckCircle2 size={40} />
                                    </div>
                                    <h4 className="text-2xl font-bold text-foreground mb-3">Snippet Secured</h4>
                                    <p className="text-sm text-foreground/40 font-medium">Your template has been encrypted and saved.</p>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} className="space-y-8">
                                    <div className="flex items-center gap-4 mb-2">
                                        <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-500">
                                            <FileText size={24} />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-2xl text-foreground tracking-tight">Template Engine</h3>
                                            <p className="text-xs text-foreground/30 font-bold uppercase tracking-widest mt-0.5">Define your transmission core.</p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest ml-1">Template Alias</label>
                                            <input 
                                                required
                                                type="text" 
                                                placeholder="e.g., IPTV Outreach - High Intent"
                                                className="w-full bg-input border border-border rounded-2xl py-4 px-6 text-sm text-foreground placeholder:text-foreground/20 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                                                value={formData.name}
                                                onChange={(e) => setFormData({...formData, name: e.target.value})}
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest ml-1">Message Content (Spintax Recommended)</label>
                                            <textarea 
                                                required
                                                rows={8}
                                                placeholder="'{Hello|Hi|Hey} {{First Name}}, I noticed...'"
                                                className="w-full bg-input border border-border rounded-2xl py-4 px-6 text-sm text-foreground placeholder:text-foreground/20 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all resize-none font-medium leading-relaxed"
                                                value={formData.content}
                                                onChange={(e) => setFormData({...formData, content: e.target.value})}
                                            />
                                        </div>
                                    </div>

                                    {error && (
                                        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-xs font-bold animate-in fade-in slide-in-from-top-2">
                                            <AlertCircle size={14} />
                                            {error}
                                        </div>
                                    )}

                                    <div className="flex justify-end gap-4 pt-4 border-t border-border">
                                        <button 
                                            type="button" 
                                            onClick={() => setIsCreating(false)} 
                                            className="px-8 py-4 rounded-2xl text-sm font-bold text-foreground/40 hover:text-foreground transition-all"
                                        >
                                            Discard Changes
                                        </button>
                                        <button 
                                            type="submit" 
                                            disabled={loading}
                                            className="bg-indigo-500 hover:bg-indigo-600 text-white px-10 py-4 rounded-2xl text-sm font-bold shadow-xl shadow-indigo-500/20 disabled:opacity-50 transition-all active:scale-95"
                                        >
                                            {loading ? <Loader2 size={18} className="animate-spin shrink-0" /> : 'Apply & Save'}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
