/**
 * MeterPhotoReader — popup สำหรับถ่าย/อัปโหลดรูปมิเตอร์ แล้วให้ AI อ่านค่า
 * ใช้กับ MeterRecording.tsx เฉพาะ Plus/Pro plan เท่านั้น
 */

import { useRef, useState } from 'react';
import { Camera, Upload, X, RotateCcw, CheckCircle, AlertTriangle, Zap, Droplets, HelpCircle } from 'lucide-react';
import { getAuth } from 'firebase/auth';

export interface MeterReadResult {
    reading: number;
    meterType: 'electric' | 'water' | 'unknown';
    confidence: 'high' | 'low';
    note: string;
}

interface MeterPhotoReaderProps {
    /** ห้องที่กำลังจดมิเตอร์ (เพื่อแสดง label) */
    roomNumber: string;
    /** เรียกเมื่อผู้ใช้ยืนยันค่าที่อ่านได้ */
    onConfirm: (result: MeterReadResult) => void;
    /** เรียกเมื่อปิด modal */
    onClose: () => void;
}

// ── Image compression ─────────────────────────────────────────────────────────
/** ย่อรูปลง Canvas แล้วส่งออกเป็น base64 JPEG (<= 1MB) */
async function compressImage(file: File): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const MAX = 1200; // px
            let { width, height } = img;
            if (width > MAX || height > MAX) {
                const ratio = Math.min(MAX / width, MAX / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, width, height);

            // ลด quality ถ้ายังใหญ่เกิน
            let quality = 0.82;
            let dataUrl = canvas.toDataURL('image/jpeg', quality);
            while (dataUrl.length > 5_500_000 && quality > 0.3) {
                quality -= 0.1;
                dataUrl = canvas.toDataURL('image/jpeg', quality);
            }
            // strip data URL header → base64 only
            const base64 = dataUrl.split(',')[1];
            resolve({ base64, mimeType: 'image/jpeg' });
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

// ── API call ──────────────────────────────────────────────────────────────────
async function callReadMeter(base64: string, mimeType: string): Promise<MeterReadResult> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('กรุณาเข้าสู่ระบบก่อน');
    const token = await user.getIdToken();

    const resp = await fetch('/api/read-meter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
    });

    const json = await resp.json() as { data?: MeterReadResult; error?: string; message?: string };

    if (!resp.ok) {
        const msg = json.message ?? json.error ?? 'เกิดข้อผิดพลาด';
        throw new Error(msg);
    }
    if (!json.data) throw new Error('ไม่ได้รับผลจาก AI');
    return json.data;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MeterPhotoReader({ roomNumber, onConfirm, onClose }: MeterPhotoReaderProps) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [compressed, setCompressed] = useState<{ base64: string; mimeType: string } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<MeterReadResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editedReading, setEditedReading] = useState<string>('');

    const cameraInputRef = useRef<HTMLInputElement>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);

    // ── รับไฟล์รูป (ถ่ายหรืออัปโหลด) ─────────────────────────────────────────
    const handleFile = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
            return;
        }
        setError(null);
        setResult(null);
        setEditedReading('');

        // Preview
        const objUrl = URL.createObjectURL(file);
        setPreviewUrl(objUrl);

        // Compress
        try {
            const comp = await compressImage(file);
            setCompressed(comp);
        } catch {
            setError('ไม่สามารถอ่านรูปได้ กรุณาลองใหม่');
            setPreviewUrl(null);
        }
    };

    // ── ส่งรูปให้ AI อ่าน ────────────────────────────────────────────────────
    const handleAnalyze = async () => {
        if (!compressed) return;
        setIsLoading(true);
        setError(null);
        setResult(null);
        try {
            const r = await callReadMeter(compressed.base64, compressed.mimeType);
            setResult(r);
            setEditedReading(r.reading !== null ? r.reading.toString() : '');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่');
        } finally {
            setIsLoading(false);
        }
    };

    // ── ยืนยันค่าที่อ่านได้ ───────────────────────────────────────────────────
    const handleConfirm = () => {
        if (!result) return;
        const val = parseInt(editedReading);
        if (isNaN(val) || val < 0) {
            setError('กรุณากรอกตัวเลขที่ถูกต้อง');
            return;
        }
        onConfirm({ ...result, reading: val });
    };

    // ── Reset ─────────────────────────────────────────────────────────────────
    const handleReset = () => {
        setPreviewUrl(null);
        setCompressed(null);
        setResult(null);
        setError(null);
        setEditedReading('');
    };

    const meterTypeLabel = result?.meterType === 'electric'
        ? 'มิเตอร์ไฟฟ้า'
        : result?.meterType === 'water'
            ? 'มิเตอร์น้ำ'
            : 'ไม่ทราบประเภท';

    const meterTypeIcon = result?.meterType === 'electric'
        ? <Zap size={14} color="#F59E0B" />
        : result?.meterType === 'water'
            ? <Droplets size={14} color="#3B82F6" />
            : <HelpCircle size={14} color="#9CA3AF" />;

    return (
        <div className="meter-photo-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="meter-photo-modal">
                {/* Header */}
                <div className="meter-photo-header">
                    <div>
                        <div className="meter-photo-title">
                            <Camera size={18} />
                            อ่านมิเตอร์จากรูปถ่าย
                        </div>
                        <div className="meter-photo-subtitle">ห้อง {roomNumber}</div>
                    </div>
                    <button className="meter-photo-close" onClick={onClose} title="ปิด">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="meter-photo-body">
                    {/* ยังไม่มีรูป */}
                    {!previewUrl && (
                        <div className="meter-photo-upload-zone">
                            <div className="meter-photo-upload-icon"><Camera size={32} color="#6B7280" /></div>
                            <p className="meter-photo-upload-hint">เลือกวิธีถ่าย/อัปโหลดรูปมิเตอร์</p>
                            <div className="meter-photo-btn-row">
                                <button
                                    className="btn btn-primary"
                                    onClick={() => cameraInputRef.current?.click()}
                                    style={{ flex: 1, gap: '0.5rem' }}
                                >
                                    <Camera size={18} />
                                    ถ่ายรูป
                                </button>
                                <button
                                    className="btn btn-outline"
                                    onClick={() => uploadInputRef.current?.click()}
                                    style={{ flex: 1, gap: '0.5rem' }}
                                >
                                    <Upload size={18} />
                                    อัปโหลด
                                </button>
                            </div>
                            <p className="meter-photo-tip" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                                <AlertCircle size={14} color="#F59E0B" /> ถ่ายให้ชัด ไม่สั่น หน้าปัทม์เห็นตัวเลขครบ
                            </p>
                        </div>
                    )}

                    {/* มีรูปแล้ว */}
                    {previewUrl && (
                        <>
                            <div className="meter-photo-preview-wrap">
                                <img
                                    src={previewUrl}
                                    alt="รูปมิเตอร์"
                                    className="meter-photo-preview-img"
                                />
                                {!isLoading && !result && (
                                    <button
                                        className="meter-photo-reset-btn"
                                        onClick={handleReset}
                                        title="เลือกรูปใหม่"
                                    >
                                        <RotateCcw size={14} />
                                    </button>
                                )}
                            </div>

                            {/* ยังไม่ได้ analyze */}
                            {!isLoading && !result && (
                                <button
                                    className="btn btn-primary"
                                    onClick={handleAnalyze}
                                    style={{ width: '100%', marginTop: '0.75rem' }}
                                >
                                    <Camera size={18} />
                                    ให้ AI อ่านค่ามิเตอร์
                                </button>
                            )}

                            {/* กำลัง analyze */}
                            {isLoading && (
                                <div className="meter-photo-loading">
                                    <span className="loading-spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
                                    <span>AI กำลังอ่านค่ามิเตอร์...</span>
                                </div>
                            )}

                            {/* ผลลัพธ์ */}
                            {result && (
                                <div className="meter-photo-result">
                                    {/* Confidence badge */}
                                    <div className={`meter-photo-confidence ${result.confidence === 'high' ? 'high' : 'low'}`}>
                                        {result.confidence === 'high'
                                            ? <><CheckCircle size={13} /> มั่นใจสูง</>
                                            : <><AlertTriangle size={13} /> มั่นใจต่ำ — กรุณาตรวจสอบ</>
                                        }
                                    </div>

                                    {/* Meter type */}
                                    <div className="meter-photo-type">
                                        {meterTypeIcon}
                                        <span>{meterTypeLabel}</span>
                                    </div>

                                    {/* Note (ถ้ามี) */}
                                    {result.note && (
                                        <div className="meter-photo-note">
                                            <AlertTriangle size={13} />
                                            {result.note}
                                        </div>
                                    )}

                                    {/* ค่าที่อ่านได้ (แก้ไขได้) */}
                                    <div className="meter-photo-reading-wrap">
                                        <label className="meter-photo-reading-label">
                                            ค่าที่อ่านได้ (แก้ไขได้)
                                        </label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            className="meter-input meter-photo-reading-input"
                                            value={editedReading}
                                            onChange={e => {
                                                if (/^\d*$/.test(e.target.value)) setEditedReading(e.target.value);
                                            }}
                                            placeholder="กรอกตัวเลข"
                                            autoFocus
                                        />
                                    </div>

                                    {/* Actions */}
                                    <div className="meter-photo-actions">
                                        <button
                                            className="btn btn-outline"
                                            onClick={handleReset}
                                            style={{ flex: '0 0 auto' }}
                                        >
                                            <RotateCcw size={16} />
                                            ถ่ายใหม่
                                        </button>
                                        <button
                                            className="btn btn-success"
                                            onClick={handleConfirm}
                                            disabled={!editedReading}
                                            style={{ flex: 1 }}
                                        >
                                            <CheckCircle size={16} />
                                            ใช้ค่านี้
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="meter-photo-error">
                            <AlertTriangle size={15} />
                            {error}
                        </div>
                    )}
                </div>

                {/* Hidden file inputs */}
                <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) { handleFile(f); e.target.value = ''; } }}
                />
                <input
                    ref={uploadInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) { handleFile(f); e.target.value = ''; } }}
                />
            </div>
        </div>
    );
}
