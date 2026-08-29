import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
	// GitHub Pages serves this project at https://spongman.github.io/Thrax/
	base: '/Thrax/',
	plugins: [react()],
	server: {
		port: 3000,
		open: true
	}
})
