import crypto from 'crypto';

export function verifyWebhookSignature(req) {
    const secret = process.env.FASTCRON_SECRET;
    
    if (!secret) {
        console.warn('FASTCRON_SECRET not configured, skipping signature verification');
        return true; // Allow in development
    }
    
    // FastCron may send signature in different header formats
    const signature = req.headers['x-fastcron-signature'] || 
                     req.headers['x-signature'] || 
                     req.headers['signature'];
    
    if (!signature) {
        console.warn('No signature header found in request');
        return true; // Allow if no signature (for testing)
    }
    
    try {
        // Get request body - handle different formats
        let body;
        if (typeof req.body === 'string') {
            body = req.body;
        } else if (req.body && typeof req.body === 'object') {
            body = JSON.stringify(req.body);
        } else {
            body = '';
        }
        
        // Create expected signature
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(body, 'utf8')
            .digest('hex');
        
        // Clean the signature from header (remove any prefixes like 'sha256=')
        const cleanSignature = signature.replace(/^sha256=/, '').toLowerCase();
        const cleanExpectedSignature = expectedSignature.toLowerCase();
        
        // Ensure both signatures are the same length before comparison
        if (cleanSignature.length !== cleanExpectedSignature.length) {
            console.warn(`Signature length mismatch: received ${cleanSignature.length}, expected ${cleanExpectedSignature.length}`);
            return false;
        }
        
        // Use timing-safe comparison
        const sigBuffer = Buffer.from(cleanSignature, 'hex');
        const expectedBuffer = Buffer.from(cleanExpectedSignature, 'hex');
        
        // Double-check buffer lengths are equal
        if (sigBuffer.length !== expectedBuffer.length) {
            console.warn(`Buffer length mismatch: received ${sigBuffer.length}, expected ${expectedBuffer.length}`);
            return false;
        }
        
        return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
        
    } catch (error) {
        console.error('Signature verification error:', error);
        return false;
    }
}

export function generateWebhookSecret() {
    return crypto.randomBytes(32).toString('hex');
}

export function createTestSignature(body, secret) {
    // Utility function for testing webhook signatures
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    return crypto
        .createHmac('sha256', secret)
        .update(bodyString, 'utf8')
        .digest('hex');
}

export function validateSignatureFormat(signature) {
    // Validate that signature is a valid hex string
    if (!signature || typeof signature !== 'string') {
        return false;
    }
    
    const cleanSig = signature.replace(/^sha256=/, '');
    return /^[a-fA-F0-9]+$/.test(cleanSig) && cleanSig.length === 64;
}
