<?php
require_once 'config.php';

$database = new Database();
$db = $database->getConnection();

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? $_GET['action'] : '';

switch($method) {
    case 'POST':
        switch($action) {
            case 'login':
                login($db);
                break;
            case 'registro':
                registro($db);
                break;
            case 'recuperar':
                solicitarRecuperacion($db);
                break;
            case 'reset':
                resetPassword($db);
                break;
            default:
                echo json_encode(["error" => "Acción no válida"]);
        }
        break;
    default:
        echo json_encode(["error" => "Método no permitido"]);
}

function login($db) {
    $data = json_decode(file_get_contents("php://input"));
    
    if (!isset($data->email) || !isset($data->password)) {
        echo json_encode(["error" => "Email y contraseña requeridos"]);
        return;
    }
    
    $email = filter_var($data->email, FILTER_SANITIZE_EMAIL);
    $password = $data->password;
    
    $query = "SELECT id, nombre, apellido, email, password, rol, activo FROM usuarios WHERE email = :email";
    $stmt = $db->prepare($query);
    $stmt->bindParam(':email', $email);
    $stmt->execute();
    
    if ($stmt->rowCount() > 0) {
        $usuario = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if ($usuario['activo'] != 1) {
            echo json_encode(["error" => "Tu cuenta está desactivada. Contacta al administrador."]);
            return;
        }
        
        if (password_verify($password, $usuario['password'])) {
            // Actualizar último login
            $updateQuery = "UPDATE usuarios SET ultimo_login = NOW() WHERE id = :id";
            $updateStmt = $db->prepare($updateQuery);
            $updateStmt->bindParam(':id', $usuario['id']);
            $updateStmt->execute();
            
            // Guardar en sesión
            $_SESSION['usuario_id'] = $usuario['id'];
            $_SESSION['usuario_nombre'] = $usuario['nombre'];
            $_SESSION['usuario_apellido'] = $usuario['apellido'];
            $_SESSION['usuario_email'] = $usuario['email'];
            $_SESSION['usuario_rol'] = $usuario['rol'];
            $_SESSION['usuario_autenticado'] = true;
            
            echo json_encode([
                "success" => true,
                "mensaje" => "Login exitoso",
                "usuario" => [
                    "nombre" => $usuario['nombre'],
                    "apellido" => $usuario['apellido'],
                    "email" => $usuario['email'],
                    "rol" => $usuario['rol']
                ]
            ]);
        } else {
            echo json_encode(["error" => "Credenciales incorrectas"]);
        }
    } else {
        echo json_encode(["error" => "Usuario no encontrado"]);
    }
}

function registro($db) {
    $data = json_decode(file_get_contents("php://input"));
    
    // Validar campos requeridos
    $required = ['nombre', 'apellido', 'email', 'password', 'confirm_password'];
    foreach ($required as $field) {
        if (!isset($data->$field) || empty($data->$field)) {
            echo json_encode(["error" => "Todos los campos son requeridos"]);
            return;
        }
    }
    
    // Validar email
    $email = filter_var($data->email, FILTER_SANITIZE_EMAIL);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo json_encode(["error" => "Email no válido"]);
        return;
    }
    
    // Verificar si el email ya existe
    $checkQuery = "SELECT id FROM usuarios WHERE email = :email";
    $checkStmt = $db->prepare($checkQuery);
    $checkStmt->bindParam(':email', $email);
    $checkStmt->execute();
    
    if ($checkStmt->rowCount() > 0) {
        echo json_encode(["error" => "El email ya está registrado"]);
        return;
    }
    
    // Validar contraseñas coinciden
    if ($data->password !== $data->confirm_password) {
        echo json_encode(["error" => "Las contraseñas no coinciden"]);
        return;
    }
    
    // Validar fortaleza de contraseña
    if (strlen($data->password) < 8) {
        echo json_encode(["error" => "La contraseña debe tener al menos 8 caracteres"]);
        return;
    }
    
    // Encriptar contraseña
    $hashedPassword = password_hash($data->password, PASSWORD_DEFAULT);
    
    // Insertar nuevo usuario
    $query = "INSERT INTO usuarios (nombre, apellido, email, password, rol) 
              VALUES (:nombre, :apellido, :email, :password, 'usuario')";
    
    $stmt = $db->prepare($query);
    $stmt->bindParam(':nombre', $data->nombre);
    $stmt->bindParam(':apellido', $data->apellido);
    $stmt->bindParam(':email', $email);
    $stmt->bindParam(':password', $hashedPassword);
    
    if ($stmt->execute()) {
        echo json_encode([
            "success" => true,
            "mensaje" => "Registro exitoso. Ahora puedes iniciar sesión."
        ]);
    } else {
        echo json_encode(["error" => "Error en el registro. Intenta nuevamente."]);
    }
}

function solicitarRecuperacion($db) {
    $data = json_decode(file_get_contents("php://input"));
    
    if (!isset($data->email) || empty($data->email)) {
        echo json_encode(["error" => "Email requerido"]);
        return;
    }
    
    $email = filter_var($data->email, FILTER_SANITIZE_EMAIL);
    
    // Verificar si el email existe
    $query = "SELECT id FROM usuarios WHERE email = :email AND activo = 1";
    $stmt = $db->prepare($query);
    $stmt->bindParam(':email', $email);
    $stmt->execute();
    
    if ($stmt->rowCount() > 0) {
        $usuario = $stmt->fetch(PDO::FETCH_ASSOC);
        
        // Generar token único
        $token = bin2hex(random_bytes(50));
        $expiracion = date('Y-m-d H:i:s', strtotime('+1 hour'));
        
        // Guardar token en la base de datos
        $updateQuery = "UPDATE usuarios SET token_recuperacion = :token, token_expiracion = :expiracion WHERE id = :id";
        $updateStmt = $db->prepare($updateQuery);
        $updateStmt->bindParam(':token', $token);
        $updateStmt->bindParam(':expiracion', $expiracion);
        $updateStmt->bindParam(':id', $usuario['id']);
        
        if ($updateStmt->execute()) {
            // En un sistema real, aquí enviarías un email con el enlace de recuperación
            // Para este ejemplo, devolvemos el token (en producción NO hacer esto)
            echo json_encode([
                "success" => true,
                "mensaje" => "Se ha enviado un enlace de recuperación a tu email.",
                "token" => $token // Solo para desarrollo
            ]);
        } else {
            echo json_encode(["error" => "Error al procesar la solicitud"]);
        }
    } else {
        echo json_encode(["error" => "No se encontró una cuenta activa con ese email"]);
    }
}

function resetPassword($db) {
    $data = json_decode(file_get_contents("php://input"));
    
    $required = ['token', 'password', 'confirm_password'];
    foreach ($required as $field) {
        if (!isset($data->$field) || empty($data->$field)) {
            echo json_encode(["error" => "Todos los campos son requeridos"]);
            return;
        }
    }
    
    // Validar contraseñas
    if ($data->password !== $data->confirm_password) {
        echo json_encode(["error" => "Las contraseñas no coinciden"]);
        return;
    }
    
    if (strlen($data->password) < 8) {
        echo json_encode(["error" => "La contraseña debe tener al menos 8 caracteres"]);
        return;
    }
    
    // Verificar token válido y no expirado
    $query = "SELECT id FROM usuarios WHERE token_recuperacion = :token AND token_expiracion > NOW()";
    $stmt = $db->prepare($query);
    $stmt->bindParam(':token', $data->token);
    $stmt->execute();
    
    if ($stmt->rowCount() > 0) {
        $usuario = $stmt->fetch(PDO::FETCH_ASSOC);
        
        // Encriptar nueva contraseña
        $hashedPassword = password_hash($data->password, PASSWORD_DEFAULT);
        
        // Actualizar contraseña y limpiar token
        $updateQuery = "UPDATE usuarios SET password = :password, token_recuperacion = NULL, token_expiracion = NULL WHERE id = :id";
        $updateStmt = $db->prepare($updateQuery);
        $updateStmt->bindParam(':password', $hashedPassword);
        $updateStmt->bindParam(':id', $usuario['id']);
        
        if ($updateStmt->execute()) {
            echo json_encode([
                "success" => true,
                "mensaje" => "Contraseña actualizada exitosamente. Ahora puedes iniciar sesión."
            ]);
        } else {
            echo json_encode(["error" => "Error al actualizar la contraseña"]);
        }
    } else {
        echo json_encode(["error" => "Token inválido o expirado"]);
    }
}
?>