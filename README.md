# Mantenimiento preventivo · Bomba de aguas fecales

Aplicación estática para GitHub Pages con cuatro áreas independientes:

- Guía didáctica de la prueba.
- Simulación libre.
- Registro de una prueba real con descarga en JSON.
- Histórico con gráfica de intensidad y gráfica de tiempo de vaciado remanente.

## Publicación inicial

1. Crea un repositorio en GitHub con rama `main`.
2. Sube el contenido de este proyecto a la raíz del repositorio.
3. En `Settings > Pages`, selecciona `Deploy from a branch`.
4. Selecciona la rama `main` y la carpeta `/ (root)`.
5. Guarda la configuración.

## Registrar una prueba

La opción `Registrar prueba` genera un archivo con nombre basado únicamente en la fecha y hora:

`AAAA-MM-DD_HHMMSS.json`

Ejemplo:

`2026-09-29_153842.json`

El archivo contiene los datos introducidos en el formulario y se descarga en el dispositivo del usuario. La web no tiene permisos de escritura sobre GitHub.

## Incorporar una prueba al histórico

1. Revisa el JSON descargado.
2. Súbelo a `data/pruebas/` desde GitHub.
3. El workflow `Actualizar índice de pruebas` valida los archivos y actualiza `data/index.json`.
4. GitHub Pages publica el cambio y el nuevo registro aparece en las dos gráficas.

Al pulsar cualquier punto de las gráficas se abre la ficha completa del registro.

## Campos del registro

- Fecha
- Realizado por
- Prueba ALARMA
- Boya PARO flotando
- Forzar MARCHA con PARO flotando
- Vaciado automático / parada al caer PARO
- Modo manual preparado
- Tiempo remanente real (s)
- Intensidad real (A)
- Resultado global
- Observaciones

Los estados admitidos son `OK` y `Revisar`.
