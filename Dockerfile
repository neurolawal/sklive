FROM node:20-alpine

# Set working directory
WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only (no build tools needed, dist is pre-built)
RUN npm install --omit=dev

# Copy application files (including pre-built dist/)
COPY . .

# Expose port (Render automatically maps the exposed port)
EXPOSE 3000

# Start server using the updated package.json start script
CMD ["npm", "start"]
