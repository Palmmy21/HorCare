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
    room_status:     'สถานะห้องพัก (มีผู้เช่า / ว่าง / ติดจอง)',
    collection:      'การเก็บเงินรอบนี้ (เก็บแล้ว / รอตรวจสลิป / ยังไม่จ่าย)',
    progress:        'งานที่เหลือรอบนี้ (จดมิเตอร์ / ส่งบิลทาง LINE)',
    stats:           'สถิติหลัก (ห้อง / รายได้ / ไฟ / น้ำ)',
    expense_summary: 'ค่าใช้จ่าย & กำไรสุทธิ',
    revenue_trend:   'กราฟรายได้และกำไรสุทธิย้อนหลัง 6 เดือน (เก็บได้จริง / ยอดที่ต้องเก็บ / กำไรจากสมุดบัญชี)',
    revenue_chart:   'รายได้มาจากไหน (ค่าห้อง / ไฟ / น้ำ)',
    rate_config:     'อัตราค่าบริการปัจจุบัน',
    recent_bills:    'บิลล่าสุด',
};

// Listed in the order the Dashboard shows them
const ALL_WIDGETS: WidgetId[] = [
    'collection', 'progress', 'room_status', 'stats',
    'revenue_trend', 'expense_summary', 'revenue_chart', 'rate_config', 'recent_bills',
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
