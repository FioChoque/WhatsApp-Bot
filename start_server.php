<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Verificar si es una solicitud OPTIONS (preflight)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['success' => false, 'message' => 'Método no permitido']);
    exit();
}

// Obtener datos del cuerpo de la solicitud
$data = json_decode(file_get_contents('php://input'), true);
$command = $data['command'] ?? '';
$path = $data['path'] ?? '';
$script = $data['script'] ?? 'index.js';

$response = ['success' => false, 'message' => ''];

try {
    switch($command) {
        case 'start':
            // Comando para Windows
            $cmd = "cd /d \"{$path}\" && start node \"{$script}\"";
            
            // Ejecutar en segundo plano
            $output = shell_exec($cmd);
            
            $response['success'] = true;
            $response['message'] = 'Servidor iniciado correctamente';
            $response['command'] = $cmd;
            break;
            
        case 'stop':
            // En Windows, podemos usar taskkill para detener procesos Node.js
            $cmd = 'taskkill /F /IM node.exe 2>&1';
            $output = shell_exec($cmd);
            
            $response['success'] = true;
            $response['message'] = 'Servidor detenido correctamente';
            $response['output'] = $output;
            break;
            
        case 'restart':
            // Primero detener, luego iniciar
            shell_exec('taskkill /F /IM node.exe 2>&1');
            sleep(1);
            
            $cmd = "cd /d \"{$path}\" && start node \"{$script}\"";
            $output = shell_exec($cmd);
            
            $response['success'] = true;
            $response['message'] = 'Servidor reiniciado correctamente';
            break;
            
        default:
            $response['message'] = 'Comando no reconocido';
    }
} catch (Exception $e) {
    $response['message'] = 'Error: ' . $e->getMessage();
}

echo json_encode($response);
?>