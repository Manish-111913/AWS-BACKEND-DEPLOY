# QRbilling Backend - AWS Lambda Deployment

## 🚀 Secure Deployment Guide

### Prerequisites
- AWS CLI configured with appropriate permissions
- Node.js and npm installed
- Docker installed and running

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Manish-111913/AWS-BACKEND-DEPLOY.git
   cd AWS-BACKEND-DEPLOY
   ```

2. **Configure environment variables:**
   ```bash
   # Copy the template file
   cp .env.lambda.template .env.lambda
   
   # Edit .env.lambda with your actual values
   # NEVER commit .env.lambda to version control!
   ```

3. **Deploy securely:**
   
   **Linux/Mac:**
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```
   
   **Windows:**
   ```cmd
   deploy.bat
   ```

### Environment Variables Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Main database connection | `postgresql://user:pass@host/db` |
| `RUNTIME_DATABASE_URL` | Runtime database connection | `postgresql://runtime:pass@host/db` |
| `JWT_SECRET` | JWT signing secret | `your-secret-key` |
| `PUBLIC_BASE_URL` | Public API base URL | `https://api.yourdomain.com` |
| `API_BASE_URL` | Internal API base URL | `https://api.yourdomain.com` |
| `GOOGLE_VISION_API_KEY` | Google Vision API key | `your-api-key` |

### 🔐 Security Best Practices

- ✅ Use `.env.lambda.template` for sharing configuration structure
- ✅ Keep actual credentials in `.env.lambda` (gitignored)
- ✅ Use AWS Parameter Store/Secrets Manager for production
- ✅ Rotate credentials regularly
- ❌ NEVER commit sensitive data to Git
- ❌ NEVER hardcode credentials in source code

### 🚨 Security Incident Response

If credentials are accidentally committed:
1. Rotate ALL exposed credentials immediately
2. Remove sensitive commits from Git history
3. Force push to overwrite remote repository
4. Update deployment configuration

### API Endpoints

- **Health Check:** `GET /api/health`
- **Database Status:** `GET /api/health/db-status`

### Architecture

- **Runtime:** Node.js 20 on AWS Lambda
- **Database:** PostgreSQL (Neon)
- **Deployment:** Docker containers via AWS ECR
- **API Gateway:** AWS HTTP API with CORS enabled

## Support

For issues or questions, please create an issue in this repository.