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
import remindParcelsHandler from './_remind-parcels.js';

// Apply the maximum duration config globally to this API gateway
export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const routeParam = req.query.route;
    const route = Array.isArray(routeParam) ? routeParam[0] : routeParam;

    switch (route) {
        case 'admin': return adminHandler(req, res);
        case 'create-checkout': return createCheckoutHandler(req, res);
        case 'invitations': return invitationsHandler(req, res);
        case 'members': return membersHandler(req, res);
        case 'meter-ocr': return meterOcrHandler(req, res);
        case 'parcels': return parcelsHandler(req, res);
        case 'work-orders': return workOrdersHandler(req, res);
        case 'remind-parcels': return remindParcelsHandler(req, res);
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
