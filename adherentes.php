<?php
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE");
header("Access-Control-Allow-Headers: Content-Type");

require_once 'config.php';

$database = new Database();
$db = $database->getConnection();

$method = $_SERVER['REQUEST_METHOD'];

// Función para limpiar teléfono (guardar sin espacios)
function limpiarTelefono($telefono) {
    if (empty($telefono)) {
        return '';
    }
    
    // Eliminar todos los espacios
    $telefono = str_replace(' ', '', $telefono);
    
    return $telefono;
}

// Función para validar DNI (8 dígitos)
function validarDNI($dni) {
    if (empty($dni)) {
        return false;
    }
    
    // Limpiar espacios y caracteres no numéricos
    $dniLimpio = preg_replace('/[^0-9]/', '', $dni);
    
    // Verificar que tenga 8 dígitos
    return strlen($dniLimpio) === 8;
}

// Función para limpiar DNI (solo números)
function limpiarDNI($dni) {
    if (empty($dni)) {
        return '';
    }
    
    // Solo números
    return preg_replace('/[^0-9]/', '', $dni);
}

switch($method) {
    case 'GET':
        // Obtener todos los adherentes CON DNI y fecha_cita
        $query = "SELECT id, dni, nombre, apellidos, telefono, edad, estado, 
                  fecha_cita,
                  DATE_FORMAT(fecha_registro, '%d/%m/%Y %H:%i') as fecha_registro,
                  DATE_FORMAT(fecha_tamizaje, '%d/%m/%Y') as fecha_tamizaje,
                  observaciones 
                  FROM adherentes ORDER BY fecha_cita ASC, id DESC";
        
        $stmt = $db->prepare($query);
        $stmt->execute();
        
        $adherentes = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            // Asegurar que la edad sea un número o null
            $row['edad'] = isset($row['edad']) && $row['edad'] !== '' ? (int)$row['edad'] : null;
            $row['observaciones'] = $row['observaciones'] ?? '';
            $row['dni'] = $row['dni'] ?? ''; // Asegurar que DNI exista
            $row['fecha_cita'] = $row['fecha_cita'] ?? null; // Asegurar que fecha_cita exista
            $adherentes[] = $row;
        }
        
        echo json_encode($adherentes);
        break;
        
    case 'POST':
        // Crear nuevo adherente o actualizar datos
        $data = json_decode(file_get_contents("php://input"));
        
        // Verificar qué tipo de operación es
        $esTamizaje = isset($data->esTamizaje) && $data->esTamizaje === true;
        $esEdicion = isset($data->esEdicion) && $data->esEdicion === true;
        $esCita = isset($data->esCita) && $data->esCita === true;
        
        if($esTamizaje && isset($data->id) && $data->id > 0) {
            // ACTUALIZACIÓN DE TAMIZAJE - Cambiar estado a "adherente"
            // Primero obtenemos las observaciones existentes
            $querySelect = "SELECT observaciones FROM adherentes WHERE id = :id";
            $stmtSelect = $db->prepare($querySelect);
            $stmtSelect->bindParam(':id', $data->id);
            $stmtSelect->execute();
            $adherente = $stmtSelect->fetch(PDO::FETCH_ASSOC);
            
            $observacionesActuales = $adherente['observaciones'] ?? '';
            $nuevasObservaciones = $data->observaciones ?? '';
            
            // Combinar observaciones existentes con las nuevas
            $observacionesCombinadas = trim($observacionesActuales);
            if ($observacionesCombinadas && $nuevasObservaciones) {
                $observacionesCombinadas .= "\n\n--- Tamizaje ---\n" . $nuevasObservaciones;
            } elseif ($nuevasObservaciones) {
                $observacionesCombinadas = "--- Tamizaje ---\n" . $nuevasObservaciones;
            }
            
            $query = "UPDATE adherentes 
                     SET estado = 'adherente', 
                         fecha_tamizaje = CURDATE(),
                         observaciones = :observaciones
                     WHERE id = :id";
            
            $stmt = $db->prepare($query);
            $stmt->bindParam(':id', $data->id);
            $stmt->bindParam(':observaciones', $observacionesCombinadas);
            
            if($stmt->execute()) {
                echo json_encode(["message" => "Tamizaje registrado exitosamente", "success" => true]);
            } else {
                echo json_encode(["message" => "Error al registrar tamizaje", "success" => false]);
            }
            
        } elseif($esCita && isset($data->id) && $data->id > 0) {
            // AGENDAR O ACTUALIZAR CITA
            // Primero obtenemos las observaciones existentes
            $querySelect = "SELECT observaciones FROM adherentes WHERE id = :id";
            $stmtSelect = $db->prepare($querySelect);
            $stmtSelect->bindParam(':id', $data->id);
            $stmtSelect->execute();
            $adherente = $stmtSelect->fetch(PDO::FETCH_ASSOC);
            
            $observacionesActuales = $adherente['observaciones'] ?? '';
            $nuevasObservaciones = $data->observaciones_cita ?? '';
            
            // Combinar observaciones existentes con las nuevas de la cita
            $observacionesCombinadas = trim($observacionesActuales);
            if ($observacionesCombinadas && $nuevasObservaciones) {
                $observacionesCombinadas .= "\n\n--- Cita ---\n" . $nuevasObservaciones;
            } elseif ($nuevasObservaciones) {
                $observacionesCombinadas = "--- Cita ---\n" . $nuevasObservaciones;
            }
            
            $query = "UPDATE adherentes 
                     SET fecha_cita = :fecha_cita,
                         observaciones = :observaciones
                     WHERE id = :id";
            
            $stmt = $db->prepare($query);
            $stmt->bindParam(':id', $data->id);
            $stmt->bindParam(':fecha_cita', $data->fecha_cita);
            $stmt->bindParam(':observaciones', $observacionesCombinadas);
            
            if($stmt->execute()) {
                echo json_encode(["message" => "Cita guardada exitosamente", "success" => true]);
            } else {
                echo json_encode(["message" => "Error al guardar cita", "success" => false]);
            }
            
        } elseif($esEdicion && isset($data->id) && $data->id > 0) {
            // ACTUALIZACIÓN DE DATOS (EDICIÓN) - No cambia estado
            // Limpiar datos
            $telefonoLimpio = limpiarTelefono($data->telefono);
            $dniLimpio = limpiarDNI($data->dni);
            
            // Validar DNI
            if (!validarDNI($data->dni)) {
                echo json_encode(["message" => "Error: El DNI debe tener 8 dígitos", "success" => false]);
                break;
            }
            
            // Verificar que el DNI no exista en otro registro
            $queryCheckDNI = "SELECT COUNT(*) as count FROM adherentes WHERE dni = :dni AND id != :id";
            $stmtCheckDNI = $db->prepare($queryCheckDNI);
            $stmtCheckDNI->bindParam(':dni', $dniLimpio);
            $stmtCheckDNI->bindParam(':id', $data->id);
            $stmtCheckDNI->execute();
            $resultDNI = $stmtCheckDNI->fetch(PDO::FETCH_ASSOC);
            
            if ($resultDNI['count'] > 0) {
                echo json_encode(["message" => "Error: El DNI ya está registrado por otro adherente", "success" => false]);
                break;
            }
            
            // Validar que el teléfono no exista ya en otro registro
            $queryCheckTel = "SELECT COUNT(*) as count FROM adherentes WHERE telefono = :telefono AND id != :id";
            $stmtCheckTel = $db->prepare($queryCheckTel);
            $stmtCheckTel->bindParam(':telefono', $telefonoLimpio);
            $stmtCheckTel->bindParam(':id', $data->id);
            $stmtCheckTel->execute();
            $resultTel = $stmtCheckTel->fetch(PDO::FETCH_ASSOC);
            
            if ($resultTel['count'] > 0) {
                echo json_encode(["message" => "Error: El número de teléfono ya está registrado por otro adherente", "success" => false]);
                break;
            }
            
            $query = "UPDATE adherentes 
                     SET dni = :dni,
                         nombre = :nombre, 
                         apellidos = :apellidos, 
                         telefono = :telefono, 
                         edad = :edad,
                         observaciones = :observaciones
                     WHERE id = :id";
            
            $stmt = $db->prepare($query);
            $stmt->bindParam(':id', $data->id);
            $stmt->bindParam(':dni', $dniLimpio);
            $stmt->bindParam(':nombre', $data->nombre);
            $stmt->bindParam(':apellidos', $data->apellidos);
            $stmt->bindParam(':telefono', $telefonoLimpio);
            
            // Manejar edad (puede ser null)
            $edad = isset($data->edad) && $data->edad !== '' ? $data->edad : null;
            $stmt->bindParam(':edad', $edad, PDO::PARAM_INT);
            
            $observaciones = $data->observaciones ?? '';
            $stmt->bindParam(':observaciones', $observaciones);
            
            if($stmt->execute()) {
                echo json_encode(["message" => "Adherente actualizado exitosamente", "success" => true]);
            } else {
                echo json_encode(["message" => "Error al actualizar adherente", "success" => false]);
            }
            
        } else {
            // CREAR NUEVO ADHERENTE
            // Limpiar datos
            $telefonoLimpio = limpiarTelefono($data->telefono);
            $dniLimpio = limpiarDNI($data->dni);
            
            // Validar DNI
            if (!validarDNI($data->dni)) {
                echo json_encode(["message" => "Error: El DNI debe tener 8 dígitos", "success" => false]);
                break;
            }
            
            // Verificar que el DNI no exista ya
            $queryCheckDNI = "SELECT COUNT(*) as count FROM adherentes WHERE dni = :dni";
            $stmtCheckDNI = $db->prepare($queryCheckDNI);
            $stmtCheckDNI->bindParam(':dni', $dniLimpio);
            $stmtCheckDNI->execute();
            $resultDNI = $stmtCheckDNI->fetch(PDO::FETCH_ASSOC);
            
            if ($resultDNI['count'] > 0) {
                echo json_encode(["message" => "Error: El DNI ya está registrado", "success" => false]);
                break;
            }
            
            // Validar que el teléfono no exista ya
            $queryCheckTel = "SELECT COUNT(*) as count FROM adherentes WHERE telefono = :telefono";
            $stmtCheckTel = $db->prepare($queryCheckTel);
            $stmtCheckTel->bindParam(':telefono', $telefonoLimpio);
            $stmtCheckTel->execute();
            $resultTel = $stmtCheckTel->fetch(PDO::FETCH_ASSOC);
            
            if ($resultTel['count'] > 0) {
                echo json_encode(["message" => "Error: El número de teléfono ya está registrado", "success" => false]);
                break;
            }
            
            $query = "INSERT INTO adherentes 
                     (dni, nombre, apellidos, telefono, edad, estado, observaciones) 
                     VALUES (:dni, :nombre, :apellidos, :telefono, :edad, 'no adherente', :observaciones)";
            
            $stmt = $db->prepare($query);
            $stmt->bindParam(':dni', $dniLimpio);
            $stmt->bindParam(':nombre', $data->nombre);
            $stmt->bindParam(':apellidos', $data->apellidos);
            $stmt->bindParam(':telefono', $telefonoLimpio);
            
            // Manejar edad (puede ser null)
            $edad = isset($data->edad) && $data->edad !== '' ? $data->edad : null;
            $stmt->bindParam(':edad', $edad, PDO::PARAM_INT);
            
            $observaciones = $data->observaciones ?? '';
            $stmt->bindParam(':observaciones', $observaciones);
            
            if($stmt->execute()) {
                echo json_encode(["message" => "Adherente creado exitosamente", "success" => true]);
            } else {
                echo json_encode(["message" => "Error al crear adherente", "success" => false]);
            }
        }
        break;
        
    case 'DELETE':
        // Eliminar adherente
        $data = json_decode(file_get_contents("php://input"));
        
        $query = "DELETE FROM adherentes WHERE id = :id";
        $stmt = $db->prepare($query);
        $stmt->bindParam(':id', $data->id);
        
        if($stmt->execute()) {
            echo json_encode(["message" => "Adherente eliminado exitosamente", "success" => true]);
        } else {
            echo json_encode(["message" => "Error al eliminar adherente", "success" => false]);
        }
        break;
        
    default:
        echo json_encode(["message" => "Método no permitido", "success" => false]);
        break;
}
?>