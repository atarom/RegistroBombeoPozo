# Mantenimiento preventivo · Bomba de aguas fecales
Aplicación estática para GitHub Pages con guía didáctica, simulación libre, registro de pruebas reales e histórico.
## Registro de pruebas
El formulario genera un JSON con fecha y hora de la prueba. La fecha y la hora en formato 24 h se introducen manualmente, junto con las comprobaciones, tiempo, intensidad y observaciones.
El resultado global se calcula automáticamente: solo es `OK` si todas las comprobaciones están en `OK` y tiempo e intensidad están dentro de los límites definidos en `config.json`; en cualquier otro caso es `Revisar`.
El archivo se descarga con nombre `AAAA-MM-DD_HHMMSS.json`. La hora del nombre sirve como identificador técnico; la hora real de la prueba es el campo `hora` del JSON.
## Histórico
Los JSON oficiales se suben a `data/pruebas/`. El workflow `Actualizar índice de pruebas` valida los archivos y regenera `data/index.json`.
El histórico ordena por fecha y hora de la prueba y permite varias pruebas en un mismo día. Los registros antiguos sin `hora` siguen siendo compatibles.
## Configuración
Las referencias, tolerancias y parámetros de simulación se modifican únicamente en `config.json`.
## Simulación
La simulación libre es didáctica e independiente del registro real. Incluye nivel, boyas, funcionamiento AUTO/MANUAL y cronómetro de bombeo.
## Publicación
GitHub Pages debe publicar la rama `main` desde `/ (root)`.
