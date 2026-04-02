FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies needed for vite build)
RUN npm install

# Copy application files
COPY . .

# Build the Vite frontend
RUN npm run build

# Expose port (Render automatically maps the exposed port)
EXPOSE 3000

# Start server using the updated package.json start script
CMD ["npm", "start"]
