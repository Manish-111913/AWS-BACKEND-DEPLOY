// WhatsApp integration removed. Provide a minimal stub to avoid runtime errors if imported.
class RemovedWhatsAppService {
    async waitUntilReady() {
        return false;
    }
    async getClientStatus() {
        return { isReady: false, clientState: 'REMOVED' };
    }
}

let instance = null;
module.exports = {
    getWhatsAppService: () => {
        if (!instance) instance = new RemovedWhatsAppService();
        return instance;
    }
};
