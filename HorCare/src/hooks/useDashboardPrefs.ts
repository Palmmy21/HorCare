import { useState, useCallback } from 'react';

export type WidgetId =
    | 'room_status'
    | 'collection'
    | 'progress'
    | 'stats'
    | 'expense_summary'
    | 'revenue_trend'
    | 'revenue_chart'
    | 'rate_config'
    | 'recent_bills';

export const WIDGET_LABELS: Record<WidgetId, string> = {
    room_status:     'ภาพรวมสถานะห้องพัก (มีผู้เช่า / ว่าง / ติดจอง)',
    collection:      'การเก็บเงิน (คาดการณ์ / จริง / ค้าง)',
    progress:        'สถานะการจดมิเตอร์',
    stats:           'สถิติหลัก (ห้อง / รายได้ / ไฟ / น้ำ)',
    expense_summary: 'ค่าใช้จ่าย & กำไรสุทธิ',
    revenue_trend:   'กราฟรายได้ vs ค่าใช้จ่าย ย้อนหลัง 6 เดือน',
    revenue_chart:   'กราฟสัดส่วนรายได้',
    rate_config:     'อัตราค่าบริการปัจจุบัน',
    recent_bills:    'รายการบิลล่าสุด',
};

const ALL_WIDGETS: WidgetId[] = [
    'room_status',
    'collection', 'progress', 'stats', 'expense_summary',
    'revenue_trend', 'revenue_chart', 'rate_config', 'recent_bills',
];
// v4 — added room_status; bump so existing users see it
const STORAGE_KEY = 'horcare_dashboard_prefs_v4';

function loadPrefs(key: string): WidgetId[] {
    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            const parsed = JSON.parse(stored) as WidgetId[];
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch { /* ignore */ }
    return [...ALL_WIDGETS];
}

export function useDashboardPrefs(uid?: string) {
    const key = uid ? `${STORAGE_KEY}_${uid}` : STORAGE_KEY;
    const [enabledWidgets, setEnabledWidgets] = useState<WidgetId[]>(() => loadPrefs(key));

    const toggle = useCallback((id: WidgetId) => {
        setEnabledWidgets(prev => {
            const next = prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id];
            localStorage.setItem(key, JSON.stringify(next));
            return next;
        });
    }, [key]);

    const isEnabled = useCallback((id: WidgetId) => enabledWidgets.includes(id), [enabledWidgets]);

    return { enabledWidgets, allWidgets: ALL_WIDGETS, toggle, isEnabled };
}
