import { Component, type ErrorInfo, type ReactNode } from 'react';

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
        console.error('ErrorBoundary caught:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100vh',
                    flexDirection: 'column',
                    gap: '1rem',
                    padding: '2rem',
                    textAlign: 'center',
                    fontFamily: "'Inter', sans-serif"
                }}>
                    <div style={{ fontSize: '3rem' }}>⚠️</div>
                    <h2 style={{ color: '#EF4444' }}>เกิดข้อผิดพลาด</h2>
                    <p style={{ color: '#737373', maxWidth: '400px' }}>
                        กรุณาลองรีเฟรชหน้าเว็บ หากยังพบปัญหา กรุณาติดต่อผู้ดูแลระบบ
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            marginTop: '1rem',
                            padding: '0.75rem 1.5rem',
                            background: '#3B82F6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.5rem',
                            cursor: 'pointer',
                            fontWeight: 500
                        }}
                    >
                        🔄 รีเฟรชหน้าเว็บ
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
