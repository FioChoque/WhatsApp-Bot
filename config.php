<?php
session_start();

class Database {
    private $host = "localhost";
    private $db_name = "whatsaap_bd";
    private $username = "root";
    private $password = "";
    public $conn;

    public function getConnection() {
        $this->conn = null;
        try {
            $this->conn = new PDO(
                "mysql:host=" . $this->host . ";dbname=" . $this->db_name . ";charset=utf8mb4",
                $this->username,
                $this->password
            );
            $this->conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $this->conn->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        } catch(PDOException $exception) {
            error_log("Error de conexión: " . $exception->getMessage());
            if (isset($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) == 'xmlhttprequest') {
                echo json_encode(["error" => "Error de conexión a la base de datos"]);
            } else {
                die("Error de conexión a la base de datos. Por favor, intente más tarde.");
            }
            exit();
        }
        return $this->conn;
    }
}

// Función para verificar si el usuario está logueado
function verificarAutenticacion() {
    if (!isset($_SESSION['usuario_id']) || !isset($_SESSION['usuario_nombre']) || !isset($_SESSION['usuario_rol'])) {
        header('Location: login.html');
        exit();
    }
}

// Función para obtener información del usuario actual
function obtenerUsuarioActual() {
    if (isset($_SESSION['usuario_id'])) {
        return [
            'id' => $_SESSION['usuario_id'],
            'nombre' => $_SESSION['usuario_nombre'],
            'apellido' => $_SESSION['usuario_apellido'],
            'email' => $_SESSION['usuario_email'],
            'rol' => $_SESSION['usuario_rol']
        ];
    }
    return null;
}
?>