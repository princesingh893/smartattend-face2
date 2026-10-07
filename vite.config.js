import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          // अगर फाइल node_modules के अंदर है और उसमें face-api या tfjs है, तो उसे अलग चंक बना दो
          if (id.includes('node_modules') && (id.includes('face-api') || id.includes('tfjs') || id.includes('vladmandic'))) {
            return 'faceapi-vendor';
          }
        }
      }
    }
  }
})
