# Use the official AWS Lambda Node.js base image
FROM public.ecr.aws/lambda/nodejs:20

# Install Python only (without external packages for now)
# The application will use JavaScript fallback if Python packages are missing
RUN microdnf update -y && \
    microdnf install -y python3 && \
    ln -sf /usr/bin/python3 /usr/bin/python

# Note: Python packages (google-generativeai) will be installed later via Layer or different approach
# For now, the application uses JavaScript fallback parsing

# Set the working directory to Lambda's task root
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev --cache /tmp/.npm

# Copy application code
COPY . .

# Set the CMD to your handler
CMD ["server.handler"]