import crypto from 'crypto';

export function verifyWebhookSignature(req) {
    const secret = process.env.FASTCRON_SECRET;
    
    if (!secret) {
        console.warn('FASTCRON_SECRET not configured, skipping signature verification');
        return true; // Allow in development
    }
    
    const signature = req.headers['x-fastcron-signature'];
    
    if (!signature) {
        return false;
    }
    
    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
    
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
}

export function generateWebhookSecret() {
    return crypto.randomBytes(32).toString('hex');
}
