import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[ErrorBoundary]', error.message, error.stack, errorInfo.componentStack);
    }

    render() {
        if (this.state.hasError) {
            const msg = this.state.error?.message ?? '';
            const isDev = import.meta.env.DEV;
            return (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '100vh',
                    flexDirection: 'column',
                    gap: '1rem',
                    padding: '2rem',
                    textAlign: 'center',
                    fontFamily: "var(--font-sans)",
                    background: '#F4F7FB',
                }}>
                    <div><AlertTriangle size={64} color="#EF4444" /></div>
                    <h2 style={{ color: '#EF4444', margin: 0 }}>เกิดข้อผิดพลาด</h2>
                    <p style={{ color: '#737373', maxWidth: '400px', margin: 0 }}>
                        กรุณาลองรีเฟรชหน้าเว็บ หากยังพบปัญหา กรุณาติดต่อผู้ดูแลระบบ
                    </p>
                    {isDev && msg && (
                        <pre style={{
                            background: '#1A3350', color: '#FCA5A5',
                            padding: '0.75rem 1rem', borderRadius: '8px',
                            fontSize: '0.75rem', textAlign: 'left',
                            maxWidth: '90vw', overflowX: 'auto', margin: 0,
                        }}>
                            {msg}
                        </pre>
                    )}
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                        <button
                            onClick={() => this.setState({ hasError: false, error: null })}
                            style={{
                                padding: '0.75rem 1.5rem', background: '#557089',
                                color: 'white', border: 'none', borderRadius: '0.5rem',
                                cursor: 'pointer', fontWeight: 500,
                            }}
                        >
                            ลองใหม่
                        </button>
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                padding: '0.75rem 1.5rem', background: '#0A6CC2',
                                color: 'white', border: 'none', borderRadius: '0.5rem',
                                cursor: 'pointer', fontWeight: 500,
                            }}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
                                <RefreshCw size={18} /> รีเฟรชหน้าเว็บ
                            </span>
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
