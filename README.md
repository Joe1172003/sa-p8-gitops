# sa-p8-gitops

Este repo dice qué corre en producción (GKE, namespace `sa-p8`) en mi Práctica 8 de Software Avanzado. ArgoCD lo lee y es lo único que aplica cambios al clúster: si algo cambia aquí, ArgoCD lo lleva al clúster; si alguien cambia algo a mano en el clúster, ArgoCD lo devuelve a lo que dice aquí.

El código y los charts viven en [Practicas-SA-B-202200271](https://github.com/Joe1172003/Practicas-SA-B-202200271/tree/main/P8).

## Qué hay en cada carpeta

- `apps/`: una Application de ArgoCD por componente. Cada una apunta al chart del repo de código, fijado a un commit.
- `valores/`: la versión de la imagen de cada componente. Es lo que actualiza el pipeline, siempre con un Pull Request. `valores/politicas.yaml` decide si las políticas de Kyverno bloquean (`Enforce`) o solo anotan (`Audit`).
- `secretos/`: las contraseñas y llaves de cada componente, cifradas con Sealed Secrets. Aunque el repo es público, solo el controlador que vive en el clúster puede abrirlas. Las genera y las cifra el script `P8/scripts/sellar-secretos.ps1` del repo de código.

La aplicación raíz (`raiz`, en el namespace `argocd`) la crea Terraform y lee la carpeta `apps/`.
