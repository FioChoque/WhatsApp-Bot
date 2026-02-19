<?php
require_once 'config.php';

header('Content-Type: application/json');

$usuario = obtenerUsuarioActual();

if ($usuario) {
    echo json_encode([
        'success' => true,
        'usuario' => $usuario
    ]);
} else {
    echo json_encode([
        'success' => false,
        'error' => 'No autenticado'
    ]);
}
?>