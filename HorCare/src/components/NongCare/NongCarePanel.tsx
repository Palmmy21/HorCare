import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles } from 'lucide-react';
import { auth } from '../../firebase/config';
import ReactMarkdown from 'react-markdown';

interface NongCarePanelProps {
    contextData: any;
    isPro: boolean;
    onUpgrade: () => void;
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    text: string;
}

export default function NongCarePanel({ contextData, isPro, onUpgrade }: NongCarePanelProps) {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            role: 'assistant',
            text: 'สวัสดีค่ะ! น้องแคร์พร้อมให้คำปรึกษาเรื่องการเงิน ภาษี และสรุปรายรับรายจ่ายของหอพักแล้วค่ะ มีอะไรให้แคร์ช่วยวิเคราะห์ไหมคะ? 😊'
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!input.trim() || isLoading) return;

        const userText = input.trim();
        setInput('');
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text: userText }]);
        setIsLoading(true);

        try {
            const token = await auth.currentUser?.getIdToken();
            const res = await fetch('/api/nong-care', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    prompt: userText,
                    context: contextData
                })
            });

            const data = await res.json();
            
            if (!res.ok) {
                if (res.status === 403) {
                    throw new Error('pro_required');
                }
                throw new Error(data.details || data.error || 'API Error');
            }

            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', text: data.reply }]);
        } catch (err: any) {
            console.error(err);
            if (err.message === 'pro_required') {
                setMessages(prev => [...prev, { 
                    id: Date.now().toString(), 
                    role: 'assistant', 
                    text: 'ขออภัยค่ะ ฟีเจอร์ที่ปรึกษา AI "น้องแคร์" เปิดให้บริการเฉพาะแพ็กเกจ Pro เท่านั้นค่ะ 🙏' 
                }]);
            } else {
                setMessages(prev => [...prev, { 
                    id: Date.now().toString(), 
                    role: 'assistant', 
                    text: `ขออภัยค่ะ ระบบมีปัญหา: ${err.message}` 
                }]);
            }
        } finally {
            setIsLoading(false);
        }
    };

    if (!isPro) {
        return (
            <div className="nongcare-locked card" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                <Sparkles size={48} color="var(--color-primary)" style={{ margin: '0 auto 1rem' }} />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--color-gray-900)' }}>
                    ปลดล็อกที่ปรึกษา AI "น้องแคร์"
                </h2>
                <p style={{ color: 'var(--color-gray-600)', maxWidth: '400px', margin: '0 auto 1.5rem', lineHeight: 1.6 }}>
                    ผู้ช่วยส่วนตัวของคุณ พร้อมสรุปรายรับ-รายจ่าย วิเคราะห์กำไร และให้คำแนะนำด้านภาษีหอพักอย่างชาญฉลาด เฉพาะแพ็กเกจ Pro
                </p>
                <button className="btn btn-primary" onClick={onUpgrade}>
                    อัปเกรดเป็น Pro
                </button>
            </div>
        );
    }

    return (
        <div className="nongcare-panel card" style={{ display: 'flex', flexDirection: 'column', height: '600px', padding: 0, overflow: 'hidden' }}>
            <div className="nongcare-header" style={{ padding: '1rem', background: 'var(--color-primary-ultra-light)', borderBottom: '1px solid var(--color-gray-200)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                    <Bot size={24} />
                </div>
                <div>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-gray-900)' }}>น้องแคร์ AI</h3>
                    <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-primary)' }}>ที่ปรึกษาด้านการเงินและภาษี</p>
                </div>
            </div>

            <div className="nongcare-messages" style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--color-gray-50)' }}>
                {messages.map(msg => (
                    <div key={msg.id} style={{ display: 'flex', gap: '0.75rem', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: msg.role === 'user' ? 'var(--color-gray-200)' : 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: msg.role === 'user' ? 'var(--color-gray-600)' : '#fff', flexShrink: 0 }}>
                            {msg.role === 'user' ? <User size={18} /> : <Bot size={18} />}
                        </div>
                        <div style={{ 
                            background: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-white)', 
                            color: msg.role === 'user' ? '#fff' : 'var(--color-gray-800)',
                            padding: '0.75rem 1rem', 
                            borderRadius: '12px',
                            borderTopRightRadius: msg.role === 'user' ? 0 : '12px',
                            borderTopLeftRadius: msg.role === 'assistant' ? 0 : '12px',
                            boxShadow: 'var(--shadow-sm)',
                            border: msg.role === 'assistant' ? '1px solid var(--color-gray-200)' : 'none',
                            fontSize: '0.9375rem',
                            lineHeight: 1.5,
                            wordBreak: 'break-word'
                        }}>
                            {msg.role === 'assistant' ? (
                                <div className="markdown-body" style={{ fontSize: '0.9375rem' }}>
                                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                                </div>
                            ) : (
                                msg.text
                            )}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div style={{ display: 'flex', gap: '0.75rem', alignSelf: 'flex-start' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                            <Bot size={18} />
                        </div>
                        <div style={{ padding: '0.75rem 1rem', background: 'var(--color-white)', borderRadius: '12px', borderTopLeftRadius: 0, boxShadow: 'var(--shadow-sm)', border: '1px solid var(--color-gray-200)' }}>
                            <Loader2 size={18} className="spin" color="var(--color-primary)" />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSend} style={{ padding: '1rem', background: 'var(--color-white)', borderTop: '1px solid var(--color-gray-200)', display: 'flex', gap: '0.5rem' }}>
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="พิมพ์ถามเรื่องภาษี, รายได้เดือนนี้..."
                    style={{ flex: 1, padding: '0.75rem 1rem', borderRadius: '999px', border: '1px solid var(--color-gray-300)', outline: 'none' }}
                    disabled={isLoading}
                />
                <button 
                    type="submit" 
                    disabled={!input.trim() || isLoading}
                    style={{ width: 44, height: 44, borderRadius: '50%', background: input.trim() && !isLoading ? 'var(--color-primary)' : 'var(--color-gray-200)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: input.trim() && !isLoading ? 'pointer' : 'default', transition: 'var(--transition-fast)' }}
                >
                    <Send size={18} style={{ marginLeft: 2 }} />
                </button>
            </form>
        </div>
    );
}
