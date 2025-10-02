# Use the official AWS Lambda Node.js base image
# This image includes the Node.js runtime and the Lambda Runtime Interface Client
FROM public.ecr.aws/lambda/nodejs:20

# Set the working directory inside the container
WORKDIR /usr/app

# Copy package.json and package-lock.json to the container
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy the rest of your backend code into the container
COPY . .

# Use a build-time argument for your .env.lambda file
ARG ENV_FILE=.env.lambda
# Copy the specific environment file into the container (optional - better to use env vars)
# COPY ${ENV_FILE} ./.env.lambda

# Define the command to start the application
# This tells Lambda to run your server.handler, which uses serverless-http
CMD ["server.handler"]