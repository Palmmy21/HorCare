import type { VercelRequest, VercelResponse } from '@vercel/node';
import adminHandler from './_admin.js';
import createCheckoutHandler from './_create-checkout.js';
import nongCareHandler from './_nong-care.js';
import notifyOwnerHandler from './_notify-owner.js';
import notifyPaymentHandler from './_notify-payment.js';
import pruneSlipsHandler from './_prune-slips.js';
import readMeterHandler from './_read-meter.js';
import remindBillsHandler from './_remind-bills.js';
import sendLineBillsHandler from './_send-line-bills.js';
import sendLineFineHandler from './_send-line-fine.js';
import sendVerifyEmailHandler from './_send-verify-email.js';
import uploadSlipHandler from './_upload-slip.js';
import notifyPushHandler from './_notify-push.js';
import invitationsHandler from './_invitations.js';
import membersHandler from './_members.js';
import meterOcrHandler from './_meter-ocr.js';
import parcelsHandler from './_parcels.js';
import workOrdersHandler from './_work-orders.js';
import lineInboxHandler from './_line-inbox.js';
import bankAccountsHandler from './_bank-accounts.js';
import reconciliationHandler from './_reconciliation.js';
import chatbotHandler from './_chatbot.js';
import marketHandler from './_market.js';
import securityAlertsHandler from './_security-alerts.js';
import tenantLinkHandler from './_tenant-link.js';
import autoPostHandler from './_auto-post.js';
import announcementsHandler from './_announcements.js';
import remindParcelsHandler from './_remind-parcels.js';
import qrHandler from './_qr.js';

// Apply the maximum duration config globally to this API gateway
export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const routeParam = req.query.route;
    const route = Array.isArray(routeParam) ? routeParam[0] : routeParam;

    try {
        await dispatch(route, req, res);
    } catch (err) {
        // An uncaught throw becomes Vercel's opaque (non-JSON) 500, which the client can only show as
        // "request_failed"; log it and return the real reason instead.
        console.error(`[api/${route}] failed:`, err);
        if (!res.headersSent) res.status(500).json({ error: 'internal_error', message: (err as Error)?.message ?? String(err) });
    }
}

async function dispatch(route: string | undefined, req: VercelRequest, res: VercelResponse) {
    switch (route) {
        case 'admin': return adminHandler(req, res);
        case 'create-checkout': return createCheckoutHandler(req, res);
        case 'invitations': return invitationsHandler(req, res);
        case 'members': return membersHandler(req, res);
        case 'meter-ocr': return meterOcrHandler(req, res);
        case 'parcels': return parcelsHandler(req, res);
        case 'work-orders': return workOrdersHandler(req, res);
        case 'line-inbox': return lineInboxHandler(req, res);
        case 'bank-accounts': return bankAccountsHandler(req, res);
        case 'reconciliation': return reconciliationHandler(req, res);
        case 'chatbot': return chatbotHandler(req, res);
        case 'market': return marketHandler(req, res);
        case 'security-alerts': return securityAlertsHandler(req, res);
        case 'tenant-link': return tenantLinkHandler(req, res);
        case 'portal': return (await import('./_portal.js')).default(req, res);
        case 'housekeepers': return (await import('./_housekeepers.js')).default(req, res);
        case 'auto-post': return autoPostHandler(req, res);
        // Heavy dependencies (XLSX writer, Supabase client) are loaded only when their route is called,
        // so they never slow the cold start of every other API route.
        case 'accounting': return (await import('./_accounting.js')).default(req, res);
        case 'ledger': return (await import('./_ledger.js')).default(req, res);
        case 'leasing': return (await import('./_leasing.js')).default(req, res);
        case 'staff-registration': return (await import('./_staff-registration.js')).default(req, res);
        case 'payment-gateway': return (await import('./_payment-gateway.js')).default(req, res);
        case 'collections': return (await import('./_collections.js')).default(req, res);
        case 'announcements': return announcementsHandler(req, res);
        case 'remind-parcels': return remindParcelsHandler(req, res);
        case 'qr': return qrHandler(req, res);
        case 'trial': return (await import('./_trial.js')).default(req, res);
        case 'listing': return (await import('./_listing.js')).default(req, res);
        case 'owner-line': return (await import('./_owner-line.js')).default(req, res);
        case 'import-map': return (await import('./_import-map.js')).default(req, res);
        case 'nong-care': return nongCareHandler(req, res);
        case 'notify-owner': return notifyOwnerHandler(req, res);
        case 'notify-payment': return notifyPaymentHandler(req, res);
        case 'notify-push': return notifyPushHandler(req, res);
        case 'prune-slips': return pruneSlipsHandler(req, res);
        case 'read-meter': return readMeterHandler(req, res);
        case 'remind-bills': return remindBillsHandler(req, res);
        case 'send-line-bills': return sendLineBillsHandler(req, res);
        case 'send-line-fine': return sendLineFineHandler(req, res);
        case 'send-verify-email': return sendVerifyEmailHandler(req, res);
        case 'upload-slip': return uploadSlipHandler(req, res);
        default:
            res.status(404).json({ error: `API route not found: ${route}` });
            return;
    }
}
