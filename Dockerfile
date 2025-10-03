# Use the official AWS Lambda Node.js base image
FROM public.ecr.aws/lambda/nodejs:20

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