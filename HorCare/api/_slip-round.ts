/**
 * A slip sent on LINE for money owed on the collection round (a stall's day / week / month, a room's stay) rather than
 * a monthly bill — a market vendor who has no monthly bill, for one. The same checks as a slip taken at the stall
 * (api/_collections.ts charge_slip): never the same slip twice, the AI reads it and compares it with what is owed and
 * the property's receiving accounts. Approved on its own → recorded as a transfer on the oldest open charge and posted
 * to the books. Otherwise nothing is recorded: the slip is kept and everyone who handles money is told, to confirm it
 * at the stall screen.
 */
import { admin, db } from './_firebase.js';
import { supabase } from './_supabase.js';
import { evaluateSlip, type SlipEvaluation } from './_slip-flow.js';
import { compressSlipToDataUrl, slipFingerprint, type SlipQR } from './_slip.js';
import { autoPostCharges } from './_ledger-auto.js';
import { raiseAlert } from './_alerts.js';
import { effectiveLicense } from '../src/shared/trial.js';
import { isPaidPlan } from '../src/shared/plans.js';
import { CHARGE_KIND_LABELS_TH, outstanding, type Charge } from '../src/shared/collections.js';

export interface RoundSlipResult {
    /** 'none' = nothing is owed on the round for this room. */
    status: 'none' | 'duplicate' | 'recorded' | 'review';
    charge?: Charge;
    owed_satang?: number;
    evaluation?: SlipEvaluation;
}

/** Open round charges of a room, oldest first. Empty when the round is not set up. */
export async function openRoundCharges(owner: string, buildingId: string, roomId: string): Promise<Charge[]> {
    try {
        const { data, error } = await supabase().from('charges').select('*').eq('owner_uid', owner).eq('building_id', buildingId)
            .eq('room_id', roomId).eq('status', 'open').order('period_start', { ascending: true }).limit(50);
        if (error) return [];
        return ((data ?? []) as Charge[]).filter(c => outstanding(c) > 0);
    } catch {
        return [];
    }
}

export async function applyRoundSlip(input: {
    owner: string; buildingId: string; roomId: string; roomNumber: string; lineUserId: string;
    img: { buffer: Buffer; contentType: string }; qr: SlipQR;
}): Promise<RoundSlipResult> {
    const charges = await openRoundCharges(input.owner, input.buildingId, input.roomId);
    const charge = charges[0];
    if (!charge) return { status: 'none' };
    const sb = supabase();
    const left = outstanding(charge);

    const fingerprint = input.qr.payload ? slipFingerprint(input.qr.payload) : null;
    if (fingerprint) {
        const dup = await sb.from('charge_payments').select('id').eq('owner_uid', input.owner).eq('building_id', input.buildingId).eq('slip_ref', fingerprint).limit(1);
        if (!dup.error && (dup.data ?? []).length) return { status: 'duplicate', charge };
    }

    const dataUrl = await compressSlipToDataUrl(input.img.buffer);
    const m = dataUrl?.match(/^data:(image\/\w+);base64,(.+)$/) ?? null;
    const license = effectiveLicense((await db.collection('users').doc(input.owner).get()).data());
    const evaluation = await evaluateSlip({
        ownerUid: input.owner, buildingId: input.buildingId, imageBase64: m ? m[2] : null, mimeType: m ? m[1] : 'image/jpeg',
        qrPayload: input.qr.payload, expectedAmount: left / 100, billCreatedAt: charge.created_at, isPro: isPaidPlan(license),
    });
    const bank = typeof evaluation.fields.slip_account_id === 'string' ? evaluation.fields.slip_account_id : null;
    const label = `${CHARGE_KIND_LABELS_TH[charge.kind] ?? 'ค่าบริการ'} ${input.roomNumber}`;

    if (evaluation.autoApprove && bank) {
        const { data, error } = await sb.rpc('collections_pay', {
            p_owner: input.owner, p_building: input.buildingId, p_charge: charge.id, p_amount: left, p_method: 'transfer', p_kind: 'payment',
            p_bank: bank, p_note: 'slip (LINE)', p_by: `line:${input.lineUserId}`, p_by_name: 'สลิปทาง LINE',
        });
        if (!error && data) {
            const payId = (data as { id: string }).id;
            await sb.from('charge_payments').update({ verification: 'unverified', slip_ref: fingerprint, slip_details: { ...evaluation.details, checks: evaluation.verdict?.checks ?? null } })
                .eq('id', payId).eq('owner_uid', input.owner).eq('building_id', input.buildingId);
            if (dataUrl) await db.doc(`users/${input.owner}/buildings/${input.buildingId}/slip_images/charge-pay-${payId}`).set({ data_url: dataUrl, charge_id: charge.id, payment_id: payId, created_at: admin.firestore.FieldValue.serverTimestamp() });
            await autoPostCharges(input.owner, input.buildingId, { uid: `line:${input.lineUserId}`, displayName: 'สลิปทาง LINE' });
            await raiseAlert({ ownerUid: input.owner, buildingId: input.buildingId, type: 'payment', title: `💳 สลิปใหม่ ${label}`, body: `รับยอดอัตโนมัติแล้ว ฿${left / 100}` });
            return { status: 'recorded', charge, owed_satang: left, evaluation };
        }
        console.error('[slip-round] payment not recorded:', error?.message);
    }

    // keep the slip for staff to confirm at the stall screen (เก็บเงินแผง → แผงนั้น → โอน → ยืนยัน)
    if (dataUrl) {
        await db.doc(`users/${input.owner}/buildings/${input.buildingId}/slip_images/round-${charge.id}-${Date.now()}`).set({
            data_url: dataUrl, charge_id: charge.id, room_number: input.roomNumber, from_line: true,
            ai_amount: evaluation.aiAmount, note: evaluation.verifyNote, created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    await raiseAlert({
        ownerUid: input.owner, buildingId: input.buildingId, type: 'payment', title: `💳 สลิปใหม่ ${label}`,
        body: `${evaluation.aiAmount != null ? `AI อ่านได้ ฿${evaluation.aiAmount} · ` : ''}${evaluation.verifyNote} — ยืนยันที่หน้าเก็บเงินแผง`,
    });
    return { status: 'review', charge, owed_satang: left, evaluation };
}
